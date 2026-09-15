import uuid
from io import BytesIO

import fitz
import tiktoken
from docx import Document as DocxDocument
from docx.opc.exceptions import PackageNotFoundError
from langchain_text_splitters import RecursiveCharacterTextSplitter
from minio.error import MinioException
from qdrant_client.http.exceptions import UnexpectedResponse
from qdrant_client.http.models import FieldCondition, Filter, MatchValue, PointStruct
from sqlalchemy.exc import DBAPIError

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.embeddings import get_embedding_model
from app.core.minio_client import get_minio_client
from app.core.qdrant_client import COLLECTION_NAME, get_qdrant_client
from app.models.activity_event import ActivityEventType
from app.models.document import Document, DocumentStatus
from app.models.document_chunk import DocumentChunk
from app.services.memoryService import MemoryService

CHUNK_SIZE_TOKENS = 512
CHUNK_OVERLAP_TOKENS = 50
EMBEDDING_BATCH_SIZE = 32

_QDRANT_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "recall-chunks")
_encoding = tiktoken.get_encoding("cl100k_base")


class PermanentProcessingError(Exception):
    """Raised for content that can never succeed on retry (corrupt file, no extractable text)."""


def _token_len(text: str) -> int:
    return len(_encoding.encode(text))


def _point_id(document_id: int, chunk_index: int) -> str:
    return str(uuid.uuid5(_QDRANT_NAMESPACE, f"{document_id}:{chunk_index}"))


def _extract_pdf_pages(data: bytes) -> list[tuple[int, str]]:
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise PermanentProcessingError(f"Could not parse PDF: {exc}") from exc

    pages = []
    for page_number, page in enumerate(doc, start=1):
        text = page.get_text().strip()
        if text:
            pages.append((page_number, text))
    doc.close()
    return pages


def _extract_docx_text(data: bytes) -> str:
    try:
        d = DocxDocument(BytesIO(data))
    except PackageNotFoundError as exc:
        raise PermanentProcessingError(f"Could not parse DOCX: {exc}") from exc

    return "\n".join(p.text for p in d.paragraphs if p.text.strip())


def _wipe_existing(db, qdrant, document_id: int) -> None:
    db.query(DocumentChunk).filter(DocumentChunk.document_id == document_id).delete()
    db.commit()
    qdrant.delete(
        collection_name=COLLECTION_NAME,
        points_selector=Filter(
            must=[FieldCondition(key="document_id", match=MatchValue(value=document_id))]
        ),
    )


@celery_app.task(
    bind=True,
    name="app.tasks.document_processor.process_document",
    autoretry_for=(ConnectionError, TimeoutError, DBAPIError, UnexpectedResponse, MinioException),
    retry_backoff=True,
    retry_backoff_max=60,
    retry_kwargs={"max_retries": 3},
)
def process_document(self, document_id: int) -> None:
    db = SessionLocal()
    doc = None
    try:
        doc = db.query(Document).filter(Document.id == document_id).first()
        if doc is None:
            return
        # Captured up front: commits expire these attributes, and the failure paths below
        # still need them after a rollback.
        owner_id = doc.user_id
        filename = doc.original_filename

        doc.status = DocumentStatus.PROCESSING
        doc.error_message = None
        db.commit()

        qdrant = get_qdrant_client()
        _wipe_existing(db, qdrant, document_id)

        minio = get_minio_client()
        response = minio.get_object(settings.MINIO_BUCKET, doc.minio_key)
        try:
            raw = response.read()
        finally:
            response.close()
            response.release_conn()

        if doc.mime_type == "application/pdf":
            pages = _extract_pdf_pages(raw)
        elif doc.mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            text = _extract_docx_text(raw)
            pages = [(None, text)] if text.strip() else []
        else:
            raise PermanentProcessingError(f"Unsupported mime type: {doc.mime_type}")

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE_TOKENS,
            chunk_overlap=CHUNK_OVERLAP_TOKENS,
            length_function=_token_len,
        )

        chunk_rows = []
        chunk_index = 0
        for page_number, page_text in pages:
            for piece in splitter.split_text(page_text):
                piece = piece.strip()
                if not piece:
                    continue
                chunk_rows.append(
                    {
                        "chunk_index": chunk_index,
                        "page_number": page_number,
                        "content": piece,
                        "token_count": _token_len(piece),
                    }
                )
                chunk_index += 1

        if not chunk_rows:
            raise PermanentProcessingError("No extractable text found in document")

        model = get_embedding_model()
        texts = [row["content"] for row in chunk_rows]
        vectors = model.encode(texts, batch_size=EMBEDDING_BATCH_SIZE, normalize_embeddings=True)

        points = []
        chunk_objs = []
        for row, vector in zip(chunk_rows, vectors):
            point_id = _point_id(document_id, row["chunk_index"])
            chunk_objs.append(
                DocumentChunk(
                    document_id=document_id,
                    chunk_index=row["chunk_index"],
                    page_number=row["page_number"],
                    content=row["content"],
                    token_count=row["token_count"],
                    qdrant_point_id=point_id,
                )
            )
            points.append(
                PointStruct(
                    id=point_id,
                    vector=vector.tolist(),
                    payload={
                        "document_id": document_id,
                        "chunk_index": row["chunk_index"],
                        "page_number": row["page_number"],
                        "text": row["content"],
                    },
                )
            )

        qdrant.upsert(collection_name=COLLECTION_NAME, points=points)

        db.add_all(chunk_objs)
        doc.status = DocumentStatus.READY
        doc.chunk_count = len(chunk_objs)
        db.commit()

        MemoryService.record(
            db,
            owner_id,
            ActivityEventType.DOCUMENT_READY,
            title=f"Ingested '{filename}'",
            subtitle=f"Indexed {len(chunk_objs)} chunks and made them searchable.",
            document_id=document_id,
        )

    except PermanentProcessingError as exc:
        db.rollback()
        if doc is not None:
            doc.status = DocumentStatus.FAILED
            doc.error_message = str(exc)[:1000]
            db.commit()
            MemoryService.record(
                db,
                owner_id,
                ActivityEventType.DOCUMENT_FAILED,
                title=f"Failed to process '{filename}'",
                subtitle=str(exc),
                document_id=document_id,
            )

    except Exception as exc:
        db.rollback()
        if doc is not None and self.request.retries >= self.max_retries:
            doc.status = DocumentStatus.FAILED
            doc.error_message = str(exc)[:1000]
            db.commit()
            MemoryService.record(
                db,
                owner_id,
                ActivityEventType.DOCUMENT_FAILED,
                title=f"Failed to process '{filename}'",
                subtitle=str(exc),
                document_id=document_id,
            )
        raise

    finally:
        db.close()
