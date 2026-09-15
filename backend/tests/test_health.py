"""Liveness must never depend on external services; readiness must report each one."""
import pytest

from app.services import healthService as health_module
from app.services.healthService import HealthService

DEPENDENCIES = ["mysql", "redis", "qdrant", "minio"]


@pytest.fixture
def all_probes_up(monkeypatch):
    for name in DEPENDENCIES:
        monkeypatch.setattr(HealthService, f"_check_{name}", staticmethod(lambda: None))


def test_liveness_is_always_ok(anon_client):
    r = anon_client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "alive"}


def test_liveness_needs_no_auth(anon_client):
    # An orchestrator has no bearer token; this must not 401.
    assert anon_client.get("/health").status_code == 200


def test_readiness_reports_every_dependency(anon_client, all_probes_up):
    r = anon_client.get("/health/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ready"
    assert sorted(body["dependencies"]) == sorted(DEPENDENCIES)
    assert all(d["status"] == "up" for d in body["dependencies"].values())


@pytest.mark.parametrize("broken", DEPENDENCIES)
def test_readiness_is_503_when_any_dependency_is_down(anon_client, all_probes_up, monkeypatch, broken):
    def explode():
        raise ConnectionError("refused")

    monkeypatch.setattr(HealthService, f"_check_{broken}", staticmethod(explode))

    r = anon_client.get("/health/ready")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "degraded"
    assert body["dependencies"][broken]["status"] == "down"
    # The other three must still be reported as up — one failure can't mask the rest.
    for name in DEPENDENCIES:
        if name != broken:
            assert body["dependencies"][name]["status"] == "up"


def test_readiness_reports_error_type_not_message(anon_client, all_probes_up, monkeypatch):
    """Driver errors can embed the DSN, and this endpoint is unauthenticated."""
    def explode():
        raise ConnectionError("mysql://recall:hunter2@db:3306/recall unreachable")

    monkeypatch.setattr(HealthService, "_check_mysql", staticmethod(explode))

    body = anon_client.get("/health/ready").json()
    assert body["dependencies"]["mysql"]["error"] == "ConnectionError"
    assert "hunter2" not in str(body)


def test_slow_probe_reports_timeout_rather_than_waiting_forever(anon_client, all_probes_up, monkeypatch):
    """A blocked dependency is reported as a timeout instead of stalling the report.

    Deliberately asserts on the response body, not wall-clock. `asyncio.wait_for`
    unblocks the *await* but cannot kill the thread underneath, so the orphaned
    thread runs to completion and TestClient waits for it on teardown. In practice
    this doesn't arise: every probe client in healthService sets its own socket
    timeout, so the blocking call itself gives up (see PROBE_TIMEOUT_SECONDS).
    """
    import time

    monkeypatch.setattr(health_module, "_WAIT_TIMEOUT_SECONDS", 0.2)

    def hang():
        time.sleep(1)

    monkeypatch.setattr(HealthService, "_check_redis", staticmethod(hang))

    r = anon_client.get("/health/ready")

    assert r.status_code == 503
    assert r.json()["dependencies"]["redis"] == {"status": "down", "error": "timeout"}
    # The healthy probes still report, so one slow dependency can't blank the report.
    assert r.json()["dependencies"]["mysql"]["status"] == "up"


def test_probe_clients_have_their_own_timeouts():
    """The real guard against a hung dependency is client-level, not asyncio-level."""
    assert health_module.PROBE_TIMEOUT_SECONDS < health_module._WAIT_TIMEOUT_SECONDS, (
        "the asyncio backstop must be looser than the client timeouts, or it masks "
        "the real error type with a generic 'timeout'"
    )
