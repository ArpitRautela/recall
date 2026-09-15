import enum
from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index
from sqlalchemy import Enum as SAEnum

from app.models.base import Base


class ActivityEventType(str, enum.Enum):
    DOCUMENT_UPLOADED = "DOCUMENT_UPLOADED"
    DOCUMENT_READY = "DOCUMENT_READY"
    DOCUMENT_FAILED = "DOCUMENT_FAILED"
    CONVERSATION_STARTED = "CONVERSATION_STARTED"


class ActivityEvent(Base):
    __tablename__ = "activity_events"
    # Serves the only read pattern: this user's events, newest first.
    __table_args__ = (Index("ix_activity_events_user_created", "user_id", "created_at"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    event_type = Column(
        SAEnum(ActivityEventType, name="activity_event_type"), nullable=False
    )
    # Denormalised so the timeline survives deletion of the thing it describes.
    title = Column(String(500), nullable=False)
    subtitle = Column(String(500), nullable=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    conversation_id = Column(
        Integer, ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
