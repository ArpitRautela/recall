"""Storage quota accounting and upload validation."""
import io
import zipfile

import pytest

from app.core.config import settings
from app.models.document import Document, DocumentStatus
from app.services.documentService import DocumentService

PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@pytest.fixture(autouse=True)
def stub_externals(monkeypatch):
    """Uploads must not touch MinIO or enqueue real Celery work."""
    stored = {}

    class FakeMinio:
        def put_object(self, bucket, key, data, length=None, content_type=None):
            stored[key] = length
            return None

    monkeypatch.setattr("app.services.documentService.get_minio_client", lambda: FakeMinio())
    monkeypatch.setattr(DocumentService, "enqueue_processing", staticmethod(lambda _id: None))
    return stored


def _existing(db, user_id, workspace_id, size, key):
    db.add(Document(
        user_id=user_id, workspace_id=workspace_id, original_filename=key,
        minio_key=key, file_size=size, mime_type=PDF_MIME,
        status=DocumentStatus.READY, chunk_count=1,
    ))
    db.commit()


PDF_HEADER = b"%PDF-1.7\n1 0 obj\n<</Type/Catalog>>\nendobj\ntrailer\n%%EOF\n"


def _pdf_bytes(size: int | None = None) -> bytes:
    """A PDF that passes content validation, padded to an exact byte length.

    Uploads are validated by magic bytes now, so the quota tests can't use
    arbitrary filler — but they still need precise sizes to test the boundary.
    """
    if size is None:
        return PDF_HEADER
    if size < len(PDF_HEADER):
        raise ValueError(f"minimum valid PDF is {len(PDF_HEADER)} bytes")
    # Trailing bytes after %%EOF are ignored by parsers and don't affect sniffing.
    return PDF_HEADER + b"p" * (size - len(PDF_HEADER))


def _docx_bytes() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<document/>")
    return buf.getvalue()


def _upload(client, name="doc.pdf", content=None, mime=PDF_MIME, workspace_id=None):
    if content is None:
        content = _pdf_bytes()
    data = {"workspace_id": str(workspace_id)} if workspace_id is not None else {}
    return client.post(
        "/api/v1/documents/upload",
        files={"file": (name, io.BytesIO(content), mime)},
        data=data,
    )


# ── usage ────────────────────────────────────────────────────────────────────

def test_usage_is_zero_for_a_new_account(client):
    body = client.get("/api/v1/documents/usage").json()
    assert body["used_bytes"] == 0
    assert body["quota_bytes"] == settings.STORAGE_QUOTA_BYTES


def test_usage_sums_every_document(client, db_session, user, workspace):
    _existing(db_session, user.id, workspace.id, 5 * 1024 * 1024, "a")
    _existing(db_session, user.id, workspace.id, 3 * 1024 * 1024, "b")

    assert client.get("/api/v1/documents/usage").json()["used_bytes"] == 8 * 1024 * 1024


def test_usage_ignores_other_users_documents(client, db_session, user, other_user, workspace):
    _existing(db_session, user.id, workspace.id, 1024, "mine")
    _existing(db_session, other_user.id, workspace.id, 999 * 1024 * 1024, "theirs")

    assert client.get("/api/v1/documents/usage").json()["used_bytes"] == 1024


def test_usage_path_is_not_captured_by_the_id_route(client):
    """/usage is a literal path and must not be parsed as /{document_id}."""
    assert client.get("/api/v1/documents/usage").status_code == 200


# ── quota enforcement ────────────────────────────────────────────────────────

def test_upload_succeeds_within_quota(client, workspace):
    r = _upload(client, content=_pdf_bytes(), workspace_id=workspace.id)
    assert r.status_code == 202
    assert r.json()["status"] == "PENDING"


def test_upload_rejected_when_it_would_exceed_quota(client, db_session, user, workspace, monkeypatch):
    monkeypatch.setattr(settings, "STORAGE_QUOTA_BYTES", 1000)
    _existing(db_session, user.id, workspace.id, 950, "already-there")

    r = _upload(client, content=_pdf_bytes(100), workspace_id=workspace.id)

    assert r.status_code == 507, "expected 507 Insufficient Storage, distinct from the 413 per-file cap"
    assert "quota" in r.json()["detail"].lower()


def test_quota_rejection_happens_before_anything_is_stored(client, db_session, user, workspace, monkeypatch, stub_externals):
    """A rejected upload must not leave bytes in object storage."""
    monkeypatch.setattr(settings, "STORAGE_QUOTA_BYTES", 1000)
    _existing(db_session, user.id, workspace.id, 950, "already-there")

    _upload(client, content=_pdf_bytes(100), workspace_id=workspace.id)

    assert stub_externals == {}, "file reached MinIO despite being over quota"


def test_upload_allowed_exactly_at_the_quota_boundary(client, db_session, user, workspace, monkeypatch):
    monkeypatch.setattr(settings, "STORAGE_QUOTA_BYTES", 1000)
    _existing(db_session, user.id, workspace.id, 900, "already-there")

    # 900 + 100 == 1000, which is not *over* the quota.
    assert _upload(client, content=_pdf_bytes(100), workspace_id=workspace.id).status_code == 202


def test_quota_counts_only_the_callers_documents(client, db_session, user, other_user, workspace, monkeypatch):
    monkeypatch.setattr(settings, "STORAGE_QUOTA_BYTES", 1000)
    _existing(db_session, other_user.id, workspace.id, 5000, "theirs")

    # Someone else being over quota must not block this user.
    assert _upload(client, content=_pdf_bytes(100), workspace_id=workspace.id).status_code == 202


# ── upload validation ────────────────────────────────────────────────────────

def test_upload_rejects_unsupported_mime_type(client, workspace):
    r = _upload(client, name="notes.txt", mime="text/plain", workspace_id=workspace.id)
    assert r.status_code == 415


def test_upload_rejects_files_over_the_per_file_cap(client, workspace, monkeypatch):
    monkeypatch.setattr("app.services.documentService.MAX_FILE_SIZE", 10)
    # Any valid PDF exceeds the 10-byte cap; the size check runs before sniffing.
    r = _upload(client, content=_pdf_bytes(200), workspace_id=workspace.id)
    assert r.status_code == 413, "per-file cap must stay 413, distinct from the 507 quota error"


def test_upload_accepts_docx(client, workspace):
    r = _upload(client, name="report.docx", content=_docx_bytes(), mime=DOCX_MIME, workspace_id=workspace.id)
    assert r.status_code == 202


def test_new_documents_start_pending_with_no_error(client, workspace):
    body = _upload(client, workspace_id=workspace.id).json()
    assert body["status"] == "PENDING"
    assert body["error_message"] is None
    assert body["chunk_count"] == 0
