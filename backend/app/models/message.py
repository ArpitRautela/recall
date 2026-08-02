import enum
from datetime import datetime, timezone

from sqlalchemy import Column, Integer, Text, DateTime, ForeignKey, JSON
from sqlalchemy import Enum as SAEnum

from app.models.base import Base


class MessageRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(
        Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role = Column(
        SAEnum(MessageRole, name="message_role", values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
    )
    content = Column(Text, nullable=False)
    sources = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
