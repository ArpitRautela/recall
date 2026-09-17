"""Token handling and login rate limiting.

These are the highest-consequence functions in the codebase and were the least
covered. A regression here is an authentication bypass, not a bad answer.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from jose import jwt

from app.core import security
from app.core.config import settings
from app.core.security import (
    check_rate_limit,
    create_access_token,
    create_refresh_token,
    decode_token,
    reset_rate_limit,
)


# ── round trip ───────────────────────────────────────────────────────────────

def test_access_token_round_trips():
    assert decode_token(create_access_token(42), "access") == 42


def test_refresh_token_round_trips():
    assert decode_token(create_refresh_token(7), "refresh") == 7


# ── the checks that make it authentication rather than decoration ────────────

def test_a_refresh_token_cannot_be_used_as_an_access_token():
    """Refresh tokens live 7 days; accepting one as an access token would extend
    every session to a week and bypass the 30-minute window entirely."""
    with pytest.raises(HTTPException) as e:
        decode_token(create_refresh_token(1), "access")
    assert e.value.status_code == 401


def test_an_access_token_cannot_be_used_to_refresh():
    with pytest.raises(HTTPException) as e:
        decode_token(create_access_token(1), "refresh")
    assert e.value.status_code == 401


def test_token_signed_with_another_secret_is_rejected():
    forged = jwt.encode(
        {"sub": "1", "type": "access",
         "exp": datetime.now(timezone.utc) + timedelta(minutes=30)},
        "not-the-real-secret",
        algorithm=settings.JWT_ALGORITHM,
    )
    with pytest.raises(HTTPException) as e:
        decode_token(forged, "access")
    assert e.value.status_code == 401


def test_expired_token_is_rejected():
    expired = jwt.encode(
        {"sub": "1", "type": "access",
         "exp": datetime.now(timezone.utc) - timedelta(seconds=1)},
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )
    with pytest.raises(HTTPException) as e:
        decode_token(expired, "access")
    assert e.value.status_code == 401


def test_unsigned_none_algorithm_token_is_rejected():
    """The classic JWT attack: alg=none. python-jose must not accept it."""
    with pytest.raises(HTTPException) as e:
        decode_token("eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIiwidHlwZSI6ImFjY2VzcyJ9.", "access")
    assert e.value.status_code == 401


def test_garbage_is_rejected():
    for bad in ("", "not.a.token", "a.b.c", "Bearer something"):
        with pytest.raises(HTTPException):
            decode_token(bad, "access")


def test_token_without_subject_is_rejected():
    no_sub = jwt.encode(
        {"type": "access", "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
        settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM,
    )
    with pytest.raises(HTTPException) as e:
        decode_token(no_sub, "access")
    assert e.value.status_code == 401


def test_non_numeric_subject_is_rejected():
    """sub is used as a user id; a non-integer must not reach the database layer."""
    bad_sub = jwt.encode(
        {"sub": "1 OR 1=1", "type": "access",
         "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
        settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM,
    )
    with pytest.raises(HTTPException) as e:
        decode_token(bad_sub, "access")
    assert e.value.status_code == 401


def test_tokens_expire_within_the_documented_windows():
    access = jwt.decode(create_access_token(1), settings.JWT_SECRET_KEY,
                        algorithms=[settings.JWT_ALGORITHM])
    refresh = jwt.decode(create_refresh_token(1), settings.JWT_SECRET_KEY,
                         algorithms=[settings.JWT_ALGORITHM])
    now = datetime.now(timezone.utc).timestamp()
    assert 25 * 60 < access["exp"] - now <= 30 * 60
    assert 6.9 * 86400 < refresh["exp"] - now <= 7 * 86400


# ── login rate limiting ──────────────────────────────────────────────────────

class FakeRedis:
    """Minimal stand-in supporting the operations check_rate_limit uses."""

    def __init__(self):
        self.store = {}
        self.expiries = {}

    def incr(self, key):
        self.store[key] = self.store.get(key, 0) + 1
        return self.store[key]

    def expire(self, key, seconds):
        self.expiries[key] = seconds
        return True

    def get(self, key):
        v = self.store.get(key)
        return str(v).encode() if v is not None else None

    def delete(self, key):
        self.store.pop(key, None)
        self.expiries.pop(key, None)

    def ttl(self, key):
        return self.expiries.get(key, -1)


def test_rate_limit_allows_attempts_under_the_cap():
    r = FakeRedis()
    for _ in range(4):
        check_rate_limit(r, "1.2.3.4", max_attempts=5)


def test_rate_limit_blocks_once_the_cap_is_passed():
    r = FakeRedis()
    with pytest.raises(HTTPException) as e:
        for _ in range(10):
            check_rate_limit(r, "1.2.3.4", max_attempts=5)
    assert e.value.status_code == 429


def test_rate_limit_is_tracked_per_address():
    """One attacker must not be able to lock out every other user."""
    r = FakeRedis()
    for _ in range(6):
        try:
            check_rate_limit(r, "1.1.1.1", max_attempts=5)
        except HTTPException:
            pass
    check_rate_limit(r, "9.9.9.9", max_attempts=5)  # must not raise


def test_successful_login_clears_the_counter():
    r = FakeRedis()
    for _ in range(3):
        check_rate_limit(r, "1.2.3.4", max_attempts=5)
    reset_rate_limit(r, "1.2.3.4")
    for _ in range(4):
        check_rate_limit(r, "1.2.3.4", max_attempts=5)


def test_counter_is_given_an_expiry():
    """Without a TTL the window never rolls and a user is locked out forever."""
    r = FakeRedis()
    check_rate_limit(r, "1.2.3.4", max_attempts=5)
    assert any(v > 0 for v in r.expiries.values()), "no expiry set on the counter"
