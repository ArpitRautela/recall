from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.activity_event import ActivityEventType
from app.models.user_dtl import User
from app.services.documentService import DocumentService
from app.services.memoryService import MemoryService
from app.services.workspaceService import WorkspaceService

router = APIRouter()


def _document_dict(doc) -> dict:
    return {
        "id": doc.id,
        "workspace_id": doc.workspace_id,
        "original_filename": doc.original_filename,
        "file_size": doc.file_size,
        "mime_type": doc.mime_type,
        "created_at": doc.created_at,
        "status": doc.status.value,
        "chunk_count": doc.chunk_count,
        "error_message": doc.error_message,
        "updated_at": doc.updated_at,
    }


@router.post("/upload", status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    file: UploadFile = File(...),
    workspace_id: int | None = Form(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    workspace = (
        WorkspaceService.get_by_id(db, workspace_id, user.id)
        if workspace_id is not None
        else WorkspaceService.get_or_create_default(db, user.id)
    )
    minio_key, size = await DocumentService.upload_to_minio(file, user.id, db)
    doc = DocumentService.create_record(
        db, user.id, file.filename, minio_key, size, file.content_type, workspace.id
    )
    MemoryService.record(
        db,
        user.id,
        ActivityEventType.DOCUMENT_UPLOADED,
        title=f"Uploaded '{doc.original_filename}'",
        subtitle=f"Queued for processing into {workspace.name}.",
        document_id=doc.id,
    )
    DocumentService.enqueue_processing(doc.id)
    return _document_dict(doc)


@router.get("/")
async def list_documents(
    workspace_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    docs = DocumentService.list_for_user(db, user.id, workspace_id)
    return [_document_dict(d) for d in docs]


# Declared before /{document_id} so the literal path wins over the int path param.
@router.get("/usage")
async def get_usage(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return DocumentService.usage(db, user.id)


@router.get("/{document_id}")
async def get_document(
    document_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    doc = DocumentService.get_by_id(db, document_id, user.id)
    MemoryService.track_access(user.id, "document", doc.id)
    return _document_dict(doc)


@router.get("/{document_id}/chunks")
async def get_document_chunks(
    document_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    chunks = DocumentService.get_chunks(db, document_id, user.id)
    return [
        {
            "chunk_index": c.chunk_index,
            "page_number": c.page_number,
            "content": c.content,
            "token_count": c.token_count,
        }
        for c in chunks
    ]


@router.post("/{document_id}/reprocess", status_code=status.HTTP_202_ACCEPTED)
async def reprocess_document(
    document_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    doc = DocumentService.reprocess(db, document_id, user.id)
    return _document_dict(doc)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    DocumentService.delete(db, document_id, user.id)
