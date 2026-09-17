"""Upload content validation.

The declared Content-Type is client-supplied, and the stored mime_type decides
which parser the Celery task hands the bytes to. These tests pin that the
content itself is what's trusted.
"""
import io
import zipfile

import pytest

from app.models.document import Document, DocumentStatus
from app.services.documentService import DOCX_MIME, PDF_MIME, DocumentService, _sniff_mime


@pytest.fixture(autouse=True)
def stub_externals(monkeypatch):
    stored = {}

    class FakeMinio:
        def put_object(self, bucket, key, data, length=None, content_type=None):
            stored[key] = length

    monkeypatch.setattr("app.services.documentService.get_minio_client", lambda: FakeMinio())
    monkeypatch.setattr(DocumentService, "enqueue_processing", staticmethod(lambda _id: None))
    return stored


def real_pdf() -> bytes:
    return b"%PDF-1.7\n1 0 obj\n<</Type/Catalog>>\nendobj\ntrailer\n%%EOF\n"


def real_docx() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<document/>")
    return buf.getvalue()


def upload(client, name, content, declared, workspace_id=None):
    data = {"workspace_id": str(workspace_id)} if workspace_id is not None else {}
    return client.post(
        "/api/v1/documents/upload",
        files={"file": (name, io.BytesIO(content), declared)},
        data=data,
    )


# ── the sniffer itself ───────────────────────────────────────────────────────

def test_sniffs_a_real_pdf():
    assert _sniff_mime(real_pdf()) == PDF_MIME


def test_sniffs_a_real_docx():
    assert _sniff_mime(real_docx()) == DOCX_MIME


def test_plain_text_is_not_a_document():
    assert _sniff_mime(b"just some text, definitely not a pdf") is None


def test_a_bare_zip_is_not_a_docx():
    """A DOCX is a zip, but not every zip is a DOCX — require the OOXML part."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("hello.txt", "not a document")
    assert _sniff_mime(buf.getvalue()) is None


def test_truncated_zip_does_not_raise():
    assert _sniff_mime(b"PK\x03\x04" + b"garbage") is None


def test_empty_file_is_rejected():
    assert _sniff_mime(b"") is None


# ── through the endpoint ─────────────────────────────────────────────────────

def test_real_pdf_is_accepted(client, workspace):
    assert upload(client, "real.pdf", real_pdf(), PDF_MIME, workspace.id).status_code == 202


def test_real_docx_is_accepted(client, workspace):
    assert upload(client, "real.docx", real_docx(), DOCX_MIME, workspace.id).status_code == 202


def test_executable_disguised_as_pdf_is_rejected(client, workspace, stub_externals):
    """The attack this guards: arbitrary bytes claiming to be a PDF."""
    payload = b"MZ\x90\x00\x03" + b"\x00" * 64  # DOS/PE header
    r = upload(client, "malware.pdf", payload, PDF_MIME, workspace.id)
    assert r.status_code == 415
    assert stub_externals == {}, "rejected content reached object storage"


def test_text_renamed_to_pdf_is_rejected(client, workspace):
    r = upload(client, "notes.pdf", b"this is plain text", PDF_MIME, workspace.id)
    assert r.status_code == 415


def test_pdf_declared_as_docx_is_rejected(client, workspace):
    """Content and declared type must agree — the stored value picks the parser."""
    r = upload(client, "confused.docx", real_pdf(), DOCX_MIME, workspace.id)
    assert r.status_code == 415


def test_zip_bomb_shaped_archive_is_rejected(client, workspace):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("payload.bin", b"\x00" * 100_000)
    r = upload(client, "archive.docx", buf.getvalue(), DOCX_MIME, workspace.id)
    assert r.status_code == 415


def test_accepted_upload_stores_the_sniffed_type(client, db_session, workspace):
    """The persisted mime_type drives parser selection downstream."""
    upload(client, "real.pdf", real_pdf(), PDF_MIME, workspace.id)
    doc = db_session.query(Document).order_by(Document.id.desc()).first()
    assert doc.mime_type == PDF_MIME
    assert doc.status == DocumentStatus.PENDING
