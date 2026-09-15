"""Shared fixtures.

These tests run without Docker: the database is in-memory SQLite and every external
client (MinIO, Qdrant, Redis, Celery) is patched out. They cover application logic —
ownership filtering, quota arithmetic, status handling — not integration with the real
services, which still needs the stack running.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user, get_db
from app.main import app
from app.models import Base
from app.models.user_dtl import User
from app.models.workspace import Workspace


@pytest.fixture
def db_session():
    # StaticPool + shared connection: every session sees the same in-memory database.
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def user(db_session):
    u = User(full_name="Test User", email="test@example.com", password="hashed")
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u


@pytest.fixture
def other_user(db_session):
    """A second account, used to prove data never leaks across users."""
    u = User(full_name="Other Person", email="other@example.com", password="hashed")
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u


@pytest.fixture
def workspace(db_session, user):
    ws = Workspace(user_id=user.id, name="Default", is_default=True)
    db_session.add(ws)
    db_session.commit()
    db_session.refresh(ws)
    return ws


@pytest.fixture
def client(db_session, user):
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: user
    # Deliberately not `with TestClient(app)`: that runs the lifespan, which loads the
    # embedding and reranker models and reaches for MinIO/Qdrant.
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def anon_client():
    """No dependency overrides — for endpoints that take no auth, like /health."""
    return TestClient(app)
