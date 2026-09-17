import uuid
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from qdrant_client.http.models import FieldCondition, Filter, MatchValue
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.minio_client import get_minio_client
from app.core.qdrant_client import COLLECTION_NAME, get_qdrant_client
from app.models.document import Document, DocumentStatus
from app.models.document_chunk import DocumentChunk
from app.tasks.document_processor import process_document

PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
ALLOWED_MIME_TYPES = {PDF_MIME, DOCX_MIME}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


def _sniff_mime(data: bytes) -> str | None:
    """Identify the file from its own bytes.

    The multipart Content-Type header is supplied by the client and can claim
    anything. Since the processing pipeline hands these bytes to PyMuPDF and
    python-docx, trusting that header means a caller chooses which parser runs
    on their content. Magic bytes are checked instead.
    """
    if data.startswith(b"%PDF-"):
        return PDF_MIME
    # DOCX is a ZIP (PK). Distinguish it from any other zip by the
    # OOXML word/ part, rather than accepting every archive as a document.
    if data.startswith(b"PK"):
        try:
            import zipfile

            with zipfile.ZipFile(BytesIO(data)) as z:
                names = z.namelist()
            if any(n.startswith("word/") for n in names):
                return DOCX_MIME
        except zipfile.BadZipFile:
            return None
    return None


class DocumentService:

    def usage(db: Session, user_id: int) -> dict:
        used = (
            db.query(func.coalesce(func.sum(Document.file_size), 0))
            .filter(Document.user_id == user_id)
            .scalar()
        )
        return {"used_bytes": int(used), "quota_bytes": settings.STORAGE_QUOTA_BYTES}

    async def upload_to_minio(file: UploadFile, user_id: int, db: Session) -> tuple[str, int]:
        # Cheap rejection on the declared type first, so an obviously wrong upload
        # doesn't get read into memory at all.
        if file.content_type not in ALLOWED_MIME_TYPES:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=f"Unsupported file type: {file.content_type}",
            )

        ext = Path(file.filename).suffix
        minio_key = f"{user_id}/{uuid.uuid4().hex}{ext}"

        data = await file.read()
        size = len(data)

        if size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="File exceeds 50MB limit",
            )

        # Checked here, after the size is known but before anything reaches MinIO,
        # so a rejected upload never occupies storage.
        current = DocumentService.usage(db, user_id)
        if current["used_bytes"] + size > current["quota_bytes"]:
            remaining = max(current["quota_bytes"] - current["used_bytes"], 0)
            raise HTTPException(
                status_code=status.HTTP_507_INSUFFICIENT_STORAGE,
                detail=(
                    f"Storage quota exceeded. {remaining / (1024 * 1024):.1f}MB remaining, "
                    f"this file needs {size / (1024 * 1024):.1f}MB."
                ),
            )

        # Authoritative check: what the bytes actually are. The declared type is
        # only a hint, and the stored mime_type decides which parser the Celery
        # task runs, so it must come from the content.
        sniffed = _sniff_mime(data)
        if sniffed is None or sniffed not in ALLOWED_MIME_TYPES:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="File content is not a valid PDF or DOCX.",
            )
        if sniffed != file.content_type:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=(
                    f"File content is {sniffed} but was uploaded as "
                    f"{file.content_type}."
                ),
            )

        client = get_minio_client()
        client.put_object(
            settings.MINIO_BUCKET,
            minio_key,
            BytesIO(data),
            length=size,
            content_type=file.content_type,
        )
        return minio_key, size

    def create_record(db: Session, user_id: int, original_filename: str, minio_key: str, file_size: int, mime_type: str, workspace_id: int) -> Document:
        doc = Document(
            user_id=user_id,
            workspace_id=workspace_id,
            original_filename=original_filename,
            minio_key=minio_key,
            file_size=file_size,
            mime_type=mime_type,
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)
        return doc

    def list_for_user(db: Session, user_id: int, workspace_id: int | None = None) -> list[Document]:
        q = db.query(Document).filter(Document.user_id == user_id)
        if workspace_id is not None:
            q = q.filter(Document.workspace_id == workspace_id)
        return q.order_by(Document.created_at.desc()).all()

    def get_by_id(db: Session, document_id: int, user_id: int) -> Document:
        doc = (
            db.query(Document)
            .filter(Document.id == document_id, Document.user_id == user_id)
            .first()
        )
        if doc is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
        return doc

    def enqueue_processing(document_id: int) -> None:
        process_document.delay(document_id)

    def get_chunks(db: Session, document_id: int, user_id: int) -> list[DocumentChunk]:
        doc = DocumentService.get_by_id(db, document_id, user_id)
        return (
            db.query(DocumentChunk)
            .filter(DocumentChunk.document_id == doc.id)
            .order_by(DocumentChunk.chunk_index)
            .all()
        )

    def reprocess(db: Session, document_id: int, user_id: int) -> Document:
        doc = DocumentService.get_by_id(db, document_id, user_id)
        if doc.status in (DocumentStatus.PENDING, DocumentStatus.PROCESSING):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Document is already being processed",
            )
        doc.status = DocumentStatus.PENDING
        doc.error_message = None
        db.commit()
        db.refresh(doc)
        DocumentService.enqueue_processing(doc.id)
        return doc

    def delete(db: Session, document_id: int, user_id: int) -> None:
        doc = DocumentService.get_by_id(db, document_id, user_id)
        get_qdrant_client().delete(
            collection_name=COLLECTION_NAME,
            points_selector=Filter(
                must=[FieldCondition(key="document_id", match=MatchValue(value=doc.id))]
            ),
        )
        db.query(DocumentChunk).filter(DocumentChunk.document_id == doc.id).delete()
        db.commit()
        get_minio_client().remove_object(settings.MINIO_BUCKET, doc.minio_key)
        db.delete(doc)
        db.commit()
