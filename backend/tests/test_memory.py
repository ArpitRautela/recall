"""Memory endpoints must only ever expose the caller's own activity."""
from datetime import datetime, timedelta, timezone

import pytest

from app.models.activity_event import ActivityEventType
from app.models.conversation import Conversation
from app.models.document import Document, DocumentStatus
from app.services.memoryService import MemoryService

NOW = datetime.now(timezone.utc)


@pytest.fixture(autouse=True)
def no_redis(monkeypatch):
    """Access counters live in Redis; these tests don't have one."""
    class Unavailable:
        def zincrby(self, *a, **k):
            raise ConnectionError("no redis")

        def expire(self, *a, **k):
            raise ConnectionError("no redis")

        def zrevrange(self, *a, **k):
            raise ConnectionError("no redis")

    monkeypatch.setattr("app.services.memoryService.redis_client", Unavailable())


def _document(db, owner_id, workspace_id, name, key, **kw):
    doc = Document(
        user_id=owner_id,
        workspace_id=workspace_id,
        original_filename=name,
        minio_key=key,
        file_size=kw.get("size", 1024),
        mime_type="application/pdf",
        status=kw.get("status", DocumentStatus.READY),
        chunk_count=kw.get("chunks", 3),
        created_at=kw.get("created", NOW),
        updated_at=kw.get("updated", NOW),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def test_timeline_is_newest_first(client, db_session, user, workspace):
    doc = _document(db_session, user.id, workspace.id, "a.pdf", "k1")
    MemoryService.record(db_session, user.id, ActivityEventType.DOCUMENT_UPLOADED,
                         "Uploaded 'a.pdf'", "queued", document_id=doc.id)
    MemoryService.record(db_session, user.id, ActivityEventType.DOCUMENT_READY,
                         "Ingested 'a.pdf'", "3 chunks", document_id=doc.id)

    events = client.get("/api/v1/memory/timeline").json()

    assert [e["title"] for e in events] == ["Ingested 'a.pdf'", "Uploaded 'a.pdf'"]
    assert events[0]["event_type"] == "DOCUMENT_READY"


def test_timeline_excludes_other_users(client, db_session, user, other_user, workspace):
    MemoryService.record(db_session, user.id, ActivityEventType.DOCUMENT_READY, "Mine")
    MemoryService.record(db_session, other_user.id, ActivityEventType.DOCUMENT_READY, "Theirs")

    titles = [e["title"] for e in client.get("/api/v1/memory/timeline").json()]

    assert titles == ["Mine"]


def test_timeline_respects_limit(client, db_session, user):
    for i in range(5):
        MemoryService.record(db_session, user.id, ActivityEventType.DOCUMENT_READY, f"Event {i}")

    assert len(client.get("/api/v1/memory/timeline?limit=2").json()) == 2


def test_timeline_rejects_out_of_range_limit(client):
    assert client.get("/api/v1/memory/timeline?limit=0").status_code == 422
    assert client.get("/api/v1/memory/timeline?limit=500").status_code == 422


def test_recent_mixes_documents_and_conversations_newest_first(client, db_session, user, workspace):
    _document(db_session, user.id, workspace.id, "old.pdf", "k1",
              created=NOW - timedelta(days=3), updated=NOW - timedelta(days=3))
    conv = Conversation(user_id=user.id, title="Recent chat",
                        created_at=NOW - timedelta(hours=1), updated_at=NOW - timedelta(hours=1))
    db_session.add(conv)
    db_session.commit()

    items = client.get("/api/v1/memory/recent").json()

    assert [i["kind"] for i in items] == ["conversation", "document"]
    assert items[0]["title"] == "Recent chat"
    assert items[1]["title"] == "old.pdf"


def test_recent_excludes_other_users(client, db_session, user, other_user, workspace):
    _document(db_session, user.id, workspace.id, "mine.pdf", "k1")
    _document(db_session, other_user.id, workspace.id, "theirs.pdf", "k2")

    titles = [i["title"] for i in client.get("/api/v1/memory/recent").json()]

    assert titles == ["mine.pdf"]
    assert "theirs.pdf" not in titles


def test_recent_labels_untitled_conversations(client, db_session, user):
    db_session.add(Conversation(user_id=user.id, title=None, created_at=NOW, updated_at=NOW))
    db_session.commit()

    assert client.get("/api/v1/memory/recent").json()[0]["title"] == "Untitled conversation"


def test_frequent_degrades_to_empty_when_redis_is_down(client):
    """A dead cache must not 500 the page — the counters are a nicety."""
    r = client.get("/api/v1/memory/frequent")
    assert r.status_code == 200
    assert r.json() == []


def test_recording_never_raises_on_failure(db_session, user, monkeypatch):
    """Activity logging must not be able to break the operation it describes."""
    def broken_commit():
        raise RuntimeError("database gone")

    monkeypatch.setattr(db_session, "commit", broken_commit)
    monkeypatch.setattr(db_session, "rollback", lambda: None)

    # Must swallow, not propagate.
    MemoryService.record(db_session, user.id, ActivityEventType.DOCUMENT_READY, "x")
