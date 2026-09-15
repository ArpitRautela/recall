from datetime import date, timedelta

from qdrant_client.http.models import FieldCondition, Filter, MatchAny
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.embeddings import embed_texts
from app.core.qdrant_client import COLLECTION_NAME, get_qdrant_client
from app.core.reranker import rerank
from app.models.document import Document, DocumentStatus

CANDIDATE_POOL_SIZE = 20
RESULT_TOP_K = 10
RRF_K = 60  # standard reciprocal-rank-fusion smoothing constant
EXCERPT_MAX_CHARS = 300


class SearchService:

    def _filtered_document_ids(
        db: Session,
        user_id: int,
        workspace_id: int | None,
        mime_type: str | None,
        date_from: date | None,
        date_to: date | None,
    ) -> list[int]:
        q = db.query(Document.id).filter(
            Document.user_id == user_id, Document.status == DocumentStatus.READY
        )
        if workspace_id is not None:
            q = q.filter(Document.workspace_id == workspace_id)
        if mime_type is not None:
            q = q.filter(Document.mime_type == mime_type)
        if date_from is not None:
            q = q.filter(Document.created_at >= date_from)
        if date_to is not None:
            q = q.filter(Document.created_at < date_to + timedelta(days=1))
        return [row[0] for row in q.all()]

    def _semantic_candidates(query: str, doc_ids: list[int]) -> list[dict]:
        vector = embed_texts([query])[0]
        points = get_qdrant_client().query_points(
            collection_name=COLLECTION_NAME,
            query=vector,
            query_filter=Filter(
                must=[FieldCondition(key="document_id", match=MatchAny(any=doc_ids))]
            ),
            limit=CANDIDATE_POOL_SIZE,
            with_payload=True,
        ).points
        return [
            {
                "document_id": p.payload["document_id"],
                "chunk_index": p.payload["chunk_index"],
                "page_number": p.payload.get("page_number"),
                "text": p.payload["text"],
            }
            for p in points
        ]

    def _lexical_candidates(db: Session, query: str, doc_ids: list[int]) -> list[dict]:
        if not doc_ids:
            return []
        placeholders = ", ".join(f":doc_id_{i}" for i in range(len(doc_ids)))
        params = {f"doc_id_{i}": doc_id for i, doc_id in enumerate(doc_ids)}
        params.update({"query": query, "limit": CANDIDATE_POOL_SIZE})
        rows = db.execute(
            text(
                f"""
                SELECT document_id, chunk_index, page_number, content,
                       MATCH(content) AGAINST(:query IN NATURAL LANGUAGE MODE) AS score
                FROM document_chunks
                WHERE document_id IN ({placeholders})
                  AND MATCH(content) AGAINST(:query IN NATURAL LANGUAGE MODE)
                ORDER BY score DESC
                LIMIT :limit
                """
            ),
            params,
        ).mappings().all()
        return [
            {
                "document_id": r["document_id"],
                "chunk_index": r["chunk_index"],
                "page_number": r["page_number"],
                "text": r["content"],
            }
            for r in rows
        ]

    def _rrf_fuse(semantic: list[dict], lexical: list[dict]) -> list[dict]:
        scores: dict[tuple[int, int], float] = {}
        items: dict[tuple[int, int], dict] = {}
        for source in (semantic, lexical):
            for rank, item in enumerate(source):
                key = (item["document_id"], item["chunk_index"])
                scores[key] = scores.get(key, 0.0) + 1.0 / (RRF_K + rank + 1)
                items.setdefault(key, item)
        return sorted(items.values(), key=lambda it: scores[(it["document_id"], it["chunk_index"])], reverse=True)

    def search(
        db: Session,
        user_id: int,
        query: str,
        workspace_id: int | None = None,
        mime_type: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> list[dict]:
        doc_ids = SearchService._filtered_document_ids(
            db, user_id, workspace_id, mime_type, date_from, date_to
        )
        if not doc_ids:
            return []

        semantic = SearchService._semantic_candidates(query, doc_ids)
        lexical = SearchService._lexical_candidates(db, query, doc_ids)
        fused = SearchService._rrf_fuse(semantic, lexical)
        if not fused:
            return []

        scores = rerank(query, [item["text"] for item in fused])
        ranked = sorted(zip(fused, scores), key=lambda pair: pair[1], reverse=True)[:RESULT_TOP_K]

        doc_ids_in_results = {item["document_id"] for item, _ in ranked}
        docs_by_id = {
            d.id: d
            for d in db.query(Document).filter(Document.id.in_(doc_ids_in_results)).all()
        }

        results = []
        for item, score in ranked:
            chunk_text = item["text"]
            excerpt = (
                chunk_text
                if len(chunk_text) <= EXCERPT_MAX_CHARS
                else chunk_text[:EXCERPT_MAX_CHARS].rstrip() + "…"
            )
            doc = docs_by_id.get(item["document_id"])
            results.append(
                {
                    "document_id": item["document_id"],
                    "original_filename": doc.original_filename if doc else "unknown",
                    "mime_type": doc.mime_type if doc else None,
                    "chunk_index": item["chunk_index"],
                    "page_number": item["page_number"],
                    "excerpt": excerpt,
                    "score": float(score),
                }
            )
        return results
