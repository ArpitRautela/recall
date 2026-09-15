from datetime import datetime, timezone

from fastapi import HTTPException, status
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from qdrant_client.http.models import FieldCondition, Filter, MatchAny
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.embeddings import embed_texts
from app.core.qdrant_client import COLLECTION_NAME, get_qdrant_client
from app.core.reranker import rerank
from app.models.activity_event import ActivityEventType
from app.models.conversation import Conversation
from app.models.document import Document, DocumentStatus
from app.models.message import Message, MessageRole
from app.models.user_dtl import User
from app.services.memoryService import MemoryService

SYSTEM_PROMPT = (
    "You are RECALL's AI assistant. You have a search_knowledge_base tool that searches "
    "the user's uploaded documents. Use it when the question might be answered by their "
    "documents; otherwise answer directly from your own knowledge. When you use retrieved "
    "content, cite the source document and page number naturally in your answer."
)

RERANK_CANDIDATE_POOL_SIZE = 20
RERANK_TOP_K = 5
RERANK_SCORE_THRESHOLD = 0.0  # raw cross-encoder logit — starting guess, tune
                               # against real observed scores during verification
EXCERPT_MAX_CHARS = 300


def _make_search_tool(db: Session, user_id: int, captured_sources: list):
    @tool
    def search_knowledge_base(query: str) -> str:
        """Search the user's uploaded documents for content relevant to the query."""
        ready_doc_ids = [
            row[0]
            for row in db.query(Document.id)
            .filter(Document.user_id == user_id, Document.status == DocumentStatus.READY)
            .all()
        ]
        if not ready_doc_ids:
            return "The user has no processed documents available to search."

        vector = embed_texts([query])[0]
        results = get_qdrant_client().query_points(
            collection_name=COLLECTION_NAME,
            query=vector,
            query_filter=Filter(
                must=[FieldCondition(key="document_id", match=MatchAny(any=ready_doc_ids))]
            ),
            limit=RERANK_CANDIDATE_POOL_SIZE,
            with_payload=True,
        ).points

        if not results:
            return "No relevant content found in the user's documents."

        rerank_scores = rerank(query, [p.payload["text"] for p in results])
        scored = sorted(zip(results, rerank_scores), key=lambda pair: pair[1], reverse=True)
        top = [
            (point, score)
            for point, score in scored[:RERANK_TOP_K]
            if score >= RERANK_SCORE_THRESHOLD
        ]

        if not top:
            return "No sufficiently relevant content was found in the user's documents for this query."

        doc_ids = {p.payload["document_id"] for p, _ in top}
        filenames = {
            d.id: d.original_filename
            for d in db.query(Document).filter(Document.id.in_(doc_ids)).all()
        }

        lines = []
        for p, _score in top:
            payload = p.payload
            fname = filenames.get(payload["document_id"], "unknown")
            page = payload.get("page_number")
            text = payload["text"]
            excerpt = text if len(text) <= EXCERPT_MAX_CHARS else text[:EXCERPT_MAX_CHARS].rstrip() + "…"
            lines.append(f"[{fname}, page {page}]: {text}")
            captured_sources.append(
                {
                    "document_id": payload["document_id"],
                    "original_filename": fname,
                    "chunk_index": payload["chunk_index"],
                    "page_number": page,
                    "excerpt": excerpt,
                }
            )
        return "\n\n".join(lines)

    return search_knowledge_base


class ChatService:

    async def send_message(
        db: Session, user: User, conversation_id: int | None, message: str
    ) -> dict:
        if conversation_id is not None:
            conv = (
                db.query(Conversation)
                .filter(Conversation.id == conversation_id, Conversation.user_id == user.id)
                .first()
            )
            if conv is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
                )
        else:
            conv = Conversation(user_id=user.id)
            db.add(conv)
            db.commit()
            db.refresh(conv)

        prior_messages = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id)
            .order_by(Message.created_at)
            .all()
        )
        is_first_turn = len(prior_messages) == 0

        user_msg = Message(conversation_id=conv.id, role=MessageRole.USER, content=message)
        db.add(user_msg)
        db.commit()

        lc_messages = [
            HumanMessage(content=m.content) if m.role == MessageRole.USER else AIMessage(content=m.content)
            for m in prior_messages
        ] + [HumanMessage(content=message)]

        captured_sources: list = []
        search_tool = _make_search_tool(db, user.id, captured_sources)
        model = ChatOpenAI(model="gpt-4o-mini", api_key=settings.OPENAI_API_KEY)
        agent = create_react_agent(model, tools=[search_tool], prompt=SYSTEM_PROMPT)

        try:
            result = await agent.ainvoke({"messages": lc_messages})
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="AI service temporarily unavailable",
            ) from exc

        final_text = result["messages"][-1].content

        assistant_msg = Message(
            conversation_id=conv.id,
            role=MessageRole.ASSISTANT,
            content=final_text,
            sources=captured_sources or None,
        )
        db.add(assistant_msg)

        if is_first_turn:
            conv.title = message[:60] + ("…" if len(message) > 60 else "")
        conv.updated_at = datetime.now(timezone.utc)

        db.commit()
        db.refresh(assistant_msg)

        if is_first_turn:
            MemoryService.record(
                db,
                user.id,
                ActivityEventType.CONVERSATION_STARTED,
                title=f"Started conversation '{conv.title}'",
                subtitle=(
                    f"Grounded in {len(captured_sources)} source(s) from your documents."
                    if captured_sources
                    else "Answered without retrieving from your documents."
                ),
                conversation_id=conv.id,
            )

        return {
            "conversation_id": conv.id,
            "message": {
                "id": assistant_msg.id,
                "role": "assistant",
                "content": final_text,
                "sources": captured_sources or None,
                "created_at": assistant_msg.created_at,
            },
        }

    def list_conversations(db: Session, user_id: int) -> list[dict]:
        convs = (
            db.query(Conversation)
            .filter(Conversation.user_id == user_id)
            .order_by(Conversation.updated_at.desc())
            .all()
        )
        if not convs:
            return []

        conv_ids = [c.id for c in convs]

        counts = dict(
            db.query(Message.conversation_id, func.count(Message.id))
            .filter(Message.conversation_id.in_(conv_ids))
            .group_by(Message.conversation_id)
            .all()
        )

        latest_ids_subq = (
            db.query(Message.conversation_id, func.max(Message.id).label("max_id"))
            .filter(Message.conversation_id.in_(conv_ids))
            .group_by(Message.conversation_id)
            .subquery()
        )
        latest_messages = (
            db.query(Message).join(latest_ids_subq, Message.id == latest_ids_subq.c.max_id).all()
        )
        previews = {m.conversation_id: m.content for m in latest_messages}

        return [
            {
                "id": c.id,
                "title": c.title,
                "updated_at": c.updated_at,
                "message_count": counts.get(c.id, 0),
                "preview": previews.get(c.id),
            }
            for c in convs
        ]

    def get_conversation(
        db: Session, conversation_id: int, user_id: int
    ) -> tuple[Conversation, list[Message]]:
        conv = (
            db.query(Conversation)
            .filter(Conversation.id == conversation_id, Conversation.user_id == user_id)
            .first()
        )
        if conv is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
            )
        messages = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id)
            .order_by(Message.created_at)
            .all()
        )
        return conv, messages
