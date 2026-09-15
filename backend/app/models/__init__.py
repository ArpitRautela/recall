from app.models.base import Base  # noqa: F401
from app.models import user_dtl, document, document_chunk, conversation, message, workspace, activity_event  # noqa: F401 — registers all tables on Base.metadata
