from pydantic import BaseModel, field_validator


class ChatRequest(BaseModel):
    conversation_id: int | None = None
    message: str

    @field_validator("message")
    @classmethod
    def message_must_be_valid(cls, v):
        if not v.strip():
            raise ValueError("Message is required")
        if len(v) > 8000:
            raise ValueError("Message must be 8000 characters or fewer")
        return v.strip()
