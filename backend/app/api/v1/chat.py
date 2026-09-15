from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.user_dtl import User
from app.schemas.ChatRequest import ChatRequest
from app.services.chatService import ChatService
from app.services.memoryService import MemoryService

router = APIRouter()


@router.post("/")
async def send_message(
    body: ChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await ChatService.send_message(db, user, body.conversation_id, body.message)


@router.post("/stream")
async def stream_message(
    body: ChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return StreamingResponse(
        ChatService.stream_message(db, user, body.conversation_id, body.message),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Tells nginx not to buffer, which would defeat streaming entirely.
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/conversations")
async def list_conversations(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return ChatService.list_conversations(db, user.id)


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conv, messages = ChatService.get_conversation(db, conversation_id, user.id)
    MemoryService.track_access(user.id, "conversation", conv.id)
    return {
        "id": conv.id,
        "title": conv.title,
        "created_at": conv.created_at,
        "messages": [
            {
                "id": m.id,
                "role": m.role.value,
                "content": m.content,
                "sources": m.sources,
                "created_at": m.created_at,
            }
            for m in messages
        ],
    }
