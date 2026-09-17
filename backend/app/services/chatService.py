import asyncio
import json
import logging
import time
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
from app.core.logging_config import RAG_LOGGER
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

logger = logging.getLogger(__name__)
rag_log = logging.getLogger(RAG_LOGGER)


def _sse(event: str, data: dict) -> str:
    """One Server-Sent Event. Payload is JSON so newlines in tokens can't break framing."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


RERANK_CANDIDATE_POOL_SIZE = 20
RERANK_TOP_K = 5
# Raw cross-encoder logit, not a probability — see app/core/reranker.py.
#
# Measured against a real corpus (a 166-chunk Supreme Court opinion plus the
# Meridian handbook) rather than guessed:
#
#   worst genuine hit   -3.13  "is economic and political significance an
#                               unprincipled standard" — the chunk containing
#                               that exact phrase
#   best genuine miss   -5.59  "What did the Court hold about the Voting Rights
#                               Act?" — legal vocabulary, absent from the corpus
#
# The previous value of 0.0 sat three points above the worst real hit, so the
# tool discarded correct passages it had already retrieved and reported finding
# nothing. -4.0 sits inside the measured window, nearer the hit side because a
# false negative ("not in your documents") is worse than a weak extra source the
# reranker has already ranked last.
#
# ms-marco-MiniLM scores dense judicial prose far lower than the web passages it
# was trained on, so this number is domain-sensitive. Re-measure if the corpus
# changes character.
RERANK_SCORE_THRESHOLD = -4.0
EXCERPT_MAX_CHARS = 300


def _make_search_tool(db: Session, user_id: int, captured_sources: list):
    @tool
    def search_knowledge_base(query: str) -> str:
        """Search the user's uploaded documents for content relevant to the query."""
        t0 = time.perf_counter()
        q_short = query if len(query) <= 80 else query[:79] + "…"

        ready_doc_ids = [
            row[0]
            for row in db.query(Document.id)
            .filter(Document.user_id == user_id, Document.status == DocumentStatus.READY)
            .all()
        ]
        if not ready_doc_ids:
            rag_log.info(
                "search user=%s q=%r outcome=NO_READY_DOCS "
                "| the account has no documents in READY state",
                user_id, q_short,
            )
            return "The user has no processed documents available to search."

        t_embed = time.perf_counter()
        vector = embed_texts([query])[0]
        embed_ms = (time.perf_counter() - t_embed) * 1000

        t_q = time.perf_counter()
        results = get_qdrant_client().query_points(
            collection_name=COLLECTION_NAME,
            query=vector,
            query_filter=Filter(
                must=[FieldCondition(key="document_id", match=MatchAny(any=ready_doc_ids))]
            ),
            limit=RERANK_CANDIDATE_POOL_SIZE,
            with_payload=True,
        ).points
        qdrant_ms = (time.perf_counter() - t_q) * 1000

        if not results:
            rag_log.info(
                "search user=%s q=%r docs=%d candidates=0 outcome=NO_VECTOR_HITS "
                "| embed=%.0fms qdrant=%.0fms | nothing in the vector store matched the filter",
                user_id, q_short, len(ready_doc_ids), embed_ms, qdrant_ms,
            )
            return "No relevant content found in the user's documents."

        t_r = time.perf_counter()
        rerank_scores = rerank(query, [p.payload["text"] for p in results])
        rerank_ms = (time.perf_counter() - t_r) * 1000

        scored = sorted(zip(results, rerank_scores), key=lambda pair: pair[1], reverse=True)
        top = [
            (point, score)
            for point, score in scored[:RERANK_TOP_K]
            if score >= RERANK_SCORE_THRESHOLD
        ]

        best = scored[0][1]
        top_scores = ", ".join(f"{s:+.2f}" for _, s in scored[:5])
        total_ms = (time.perf_counter() - t0) * 1000

        # Per-candidate detail, for when the summary line isn't enough.
        if rag_log.isEnabledFor(logging.DEBUG):
            for rank, (p, s) in enumerate(scored, 1):
                rag_log.debug(
                    "  cand %2d score=%+7.2f %s doc=%s chunk=%s p.%s | %s",
                    rank, s, "KEEP" if s >= RERANK_SCORE_THRESHOLD else "drop",
                    p.payload["document_id"], p.payload["chunk_index"],
                    p.payload.get("page_number"),
                    p.payload["text"][:70].replace("\n", " "),
                )

        if not top:
            # The actionable number: how far the best candidate fell short. A small
            # gap means the threshold is mis-tuned; a large one means nothing relevant
            # is actually in the corpus.
            rag_log.info(
                "search user=%s q=%r docs=%d candidates=%d outcome=BELOW_THRESHOLD "
                "| best=%+.2f threshold=%+.2f short_by=%.2f top5=[%s] "
                "| embed=%.0fms qdrant=%.0fms rerank=%.0fms total=%.0fms",
                user_id, q_short, len(ready_doc_ids), len(results),
                best, RERANK_SCORE_THRESHOLD, RERANK_SCORE_THRESHOLD - best, top_scores,
                embed_ms, qdrant_ms, rerank_ms, total_ms,
            )
            return "No sufficiently relevant content was found in the user's documents for this query."

        rag_log.info(
            "search user=%s q=%r docs=%d candidates=%d outcome=OK kept=%d "
            "| best=%+.2f threshold=%+.2f top5=[%s] "
            "| embed=%.0fms qdrant=%.0fms rerank=%.0fms total=%.0fms",
            user_id, q_short, len(ready_doc_ids), len(results), len(top),
            best, RERANK_SCORE_THRESHOLD, top_scores,
            embed_ms, qdrant_ms, rerank_ms, total_ms,
        )

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

    def _prepare_turn(db: Session, user: User, conversation_id: int | None, message: str):
        """Resolve the conversation, persist the user's message, and build the agent.

        Shared by the blocking and streaming paths so they can't drift apart.
        """
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
        return conv, is_first_turn, lc_messages, captured_sources, agent

    def _finalise_turn(
        db: Session, user: User, conv, is_first_turn: bool, message: str,
        final_text: str, captured_sources: list,
    ):
        """Persist the assistant reply and title the conversation. Shared by both paths."""
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
        return assistant_msg

    async def send_message(
        db: Session, user: User, conversation_id: int | None, message: str
    ) -> dict:
        conv, is_first_turn, lc_messages, captured_sources, agent = ChatService._prepare_turn(
            db, user, conversation_id, message
        )

        try:
            result = await agent.ainvoke({"messages": lc_messages})
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="AI service temporarily unavailable",
            ) from exc

        final_text = result["messages"][-1].content

        if not captured_sources:
            # No sources means either the tool returned nothing usable, or the agent
            # chose not to call it at all. The tool logs its own outcome, so an absent
            # 'search' line above this one means the agent never searched.
            rag_log.info(
                "turn conv=%s user=%s outcome=NO_SOURCES "
                "| answered without citing documents (see whether a 'search' line precedes this)",
                conv.id, user.id,
            )
        else:
            rag_log.info("turn conv=%s user=%s outcome=GROUNDED sources=%d",
                         conv.id, user.id, len(captured_sources))

        assistant_msg = ChatService._finalise_turn(
            db, user, conv, is_first_turn, message, final_text, captured_sources
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

    async def stream_message(
        db: Session, user: User, conversation_id: int | None, message: str
    ):
        """Yield Server-Sent Events for one chat turn.

        Event order is meaningful: `meta` first so a new conversation's id is known
        before any text arrives, then `searching`/`sources` during retrieval (which
        precedes generation in a ReAct agent), then `token`s, then `done`.
        """
        conv, is_first_turn, lc_messages, captured_sources, agent = ChatService._prepare_turn(
            db, user, conversation_id, message
        )

        yield _sse("meta", {"conversation_id": conv.id})

        chunks: list[str] = []
        sources_sent = False
        failed = False

        try:
            async for event in agent.astream_events({"messages": lc_messages}, version="v2"):
                kind = event["event"]

                if kind == "on_tool_start":
                    yield _sse("searching", {"tool": event.get("name", "search_knowledge_base")})

                elif kind == "on_tool_end" and not sources_sent:
                    # Sources are captured during the tool call, so they can be shown
                    # while the answer is still being written.
                    sources_sent = True
                    yield _sse("sources", {"sources": captured_sources or []})

                elif kind == "on_chat_model_stream":
                    text = getattr(event["data"].get("chunk"), "content", "")
                    if text:
                        chunks.append(text)
                        yield _sse("token", {"text": text})

        except asyncio.CancelledError:
            # Client went away. Persist below in `finally` rather than losing the turn.
            raise
        except Exception:
            failed = True
            logger.exception("Chat streaming failed for conversation %s", conv.id)
            # Headers are already sent, so the status can't change — report in-band.
            yield _sse("error", {"detail": "AI service temporarily unavailable"})
        finally:
            final_text = "".join(chunks)
            if not captured_sources:
                rag_log.info(
                    "turn conv=%s user=%s outcome=NO_SOURCES streamed=1 "
                    "| answered without citing documents (see whether a 'search' line precedes this)",
                    conv.id, user.id,
                )
            else:
                rag_log.info("turn conv=%s user=%s outcome=GROUNDED streamed=1 sources=%d",
                             conv.id, user.id, len(captured_sources))
            if final_text:
                try:
                    assistant_msg = ChatService._finalise_turn(
                        db, user, conv, is_first_turn, message, final_text, captured_sources
                    )
                    if not failed:
                        yield _sse(
                            "done",
                            {
                                "message_id": assistant_msg.id,
                                "conversation_id": conv.id,
                                "sources": captured_sources or None,
                            },
                        )
                except Exception:
                    logger.exception("Failed to persist streamed reply for conv %s", conv.id)

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
