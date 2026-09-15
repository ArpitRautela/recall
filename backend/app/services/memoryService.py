import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.redis_client import redis_client
from app.models.activity_event import ActivityEvent, ActivityEventType
from app.models.conversation import Conversation
from app.models.document import Document

logger = logging.getLogger(__name__)

ACCESS_KEY_TTL_SECONDS = 14 * 24 * 60 * 60


def _access_key(user_id: int) -> str:
    # Bucketed per ISO week so "accessed N times this week" is literally true and
    # old buckets fall out on their own instead of needing a cleanup job.
    year, week, _ = datetime.now(timezone.utc).isocalendar()
    return f"access:{user_id}:{year}-W{week:02d}"


class MemoryService:

    def record(
        db: Session,
        user_id: int,
        event_type: ActivityEventType,
        title: str,
        subtitle: str | None = None,
        document_id: int | None = None,
        conversation_id: int | None = None,
    ) -> None:
        """Append to the activity log. Never raises — logging must not break the operation it describes."""
        try:
            db.add(
                ActivityEvent(
                    user_id=user_id,
                    event_type=event_type,
                    title=title[:500],
                    subtitle=subtitle[:500] if subtitle else None,
                    document_id=document_id,
                    conversation_id=conversation_id,
                )
            )
            db.commit()
        except Exception:
            logger.exception("Failed to record activity event for user %s", user_id)
            db.rollback()

    def track_access(user_id: int, kind: str, item_id: int) -> None:
        """Bump this week's access counter. Never raises — Redis being down must not fail a read."""
        try:
            key = _access_key(user_id)
            redis_client.zincrby(key, 1, f"{kind}:{item_id}")
            redis_client.expire(key, ACCESS_KEY_TTL_SECONDS)
        except Exception:
            logger.warning("Failed to track access for user %s", user_id, exc_info=True)

    def timeline(db: Session, user_id: int, limit: int = 50) -> list[dict]:
        events = (
            db.query(ActivityEvent)
            .filter(ActivityEvent.user_id == user_id)
            .order_by(ActivityEvent.created_at.desc(), ActivityEvent.id.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id": e.id,
                "event_type": e.event_type.value,
                "title": e.title,
                "subtitle": e.subtitle,
                "document_id": e.document_id,
                "conversation_id": e.conversation_id,
                "created_at": e.created_at,
            }
            for e in events
        ]

    def frequent(db: Session, user_id: int, limit: int = 5) -> list[dict]:
        try:
            ranked = redis_client.zrevrange(_access_key(user_id), 0, limit - 1, withscores=True)
        except Exception:
            logger.warning("Failed to read access counters for user %s", user_id, exc_info=True)
            return []

        document_ids, conversation_ids = [], []
        for member, _ in ranked:
            kind, _, raw_id = member.partition(":")
            if kind == "document":
                document_ids.append(int(raw_id))
            elif kind == "conversation":
                conversation_ids.append(int(raw_id))

        # Re-filter by user_id: Redis keys are per-user, but the DB is the authority on ownership.
        documents = (
            {
                d.id: d.original_filename
                for d in db.query(Document)
                .filter(Document.user_id == user_id, Document.id.in_(document_ids))
                .all()
            }
            if document_ids
            else {}
        )
        conversations = (
            {
                c.id: (c.title or "Untitled conversation")
                for c in db.query(Conversation)
                .filter(Conversation.user_id == user_id, Conversation.id.in_(conversation_ids))
                .all()
            }
            if conversation_ids
            else {}
        )

        results = []
        for member, score in ranked:
            kind, _, raw_id = member.partition(":")
            item_id = int(raw_id)
            title = documents.get(item_id) if kind == "document" else conversations.get(item_id)
            if title is None:
                continue  # deleted, or not this user's
            results.append(
                {"kind": kind, "id": item_id, "title": title, "access_count": int(score)}
            )
        return results

    def recent(db: Session, user_id: int, limit: int = 8) -> list[dict]:
        documents = (
            db.query(Document)
            .filter(Document.user_id == user_id)
            .order_by(Document.updated_at.desc(), Document.created_at.desc())
            .limit(limit)
            .all()
        )
        conversations = (
            db.query(Conversation)
            .filter(Conversation.user_id == user_id)
            .order_by(Conversation.updated_at.desc(), Conversation.created_at.desc())
            .limit(limit)
            .all()
        )

        items = [
            {
                "kind": "document",
                "id": d.id,
                "title": d.original_filename,
                "subtitle": d.mime_type,
                "status": d.status.value,
                "chunk_count": d.chunk_count,
                "updated_at": d.updated_at or d.created_at,
            }
            for d in documents
        ] + [
            {
                "kind": "conversation",
                "id": c.id,
                "title": c.title or "Untitled conversation",
                "subtitle": None,
                "status": None,
                "chunk_count": None,
                "updated_at": c.updated_at or c.created_at,
            }
            for c in conversations
        ]

        items.sort(key=lambda i: (i["updated_at"] is not None, i["updated_at"]), reverse=True)
        return items[:limit]
