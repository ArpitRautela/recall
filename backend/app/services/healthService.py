import asyncio

import urllib3
from minio import Minio
from qdrant_client import QdrantClient
from redis import Redis
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from app.core.config import settings

PROBE_TIMEOUT_SECONDS = 3
# Backstop only — deliberately longer than the client timeouts above so a client's own
# error (ConnectionRefusedError, etc.) surfaces instead of being masked as a generic timeout.
_WAIT_TIMEOUT_SECONDS = PROBE_TIMEOUT_SECONDS + 2

# Dedicated probe clients, each with a hard timeout. The shared app clients have no
# timeout configured, and asyncio.wait_for cannot kill a thread already blocked in a
# socket read — without these, a down dependency leaks a thread per poll for ~30s.
_probe_engine = create_engine(
    settings.DATABASE_URL,
    poolclass=NullPool,
    connect_args={"connect_timeout": PROBE_TIMEOUT_SECONDS},
)
_probe_redis = Redis.from_url(
    settings.REDIS_URL,
    socket_connect_timeout=PROBE_TIMEOUT_SECONDS,
    socket_timeout=PROBE_TIMEOUT_SECONDS,
)
_probe_qdrant = QdrantClient(
    url=settings.QDRANT_URL,
    timeout=PROBE_TIMEOUT_SECONDS,
    check_compatibility=False,
)
_probe_minio = Minio(
    settings.MINIO_ENDPOINT,
    access_key=settings.MINIO_ACCESS_KEY,
    secret_key=settings.MINIO_SECRET_KEY,
    secure=settings.MINIO_SECURE,
    http_client=urllib3.PoolManager(
        timeout=urllib3.Timeout(connect=PROBE_TIMEOUT_SECONDS, read=PROBE_TIMEOUT_SECONDS),
        retries=False,
    ),
)


class HealthService:

    def _check_mysql() -> None:
        with _probe_engine.connect() as conn:
            conn.execute(text("SELECT 1"))

    def _check_redis() -> None:
        _probe_redis.ping()

    def _check_qdrant() -> None:
        _probe_qdrant.get_collections()

    def _check_minio() -> None:
        _probe_minio.bucket_exists(settings.MINIO_BUCKET)

    async def _probe(name: str, fn) -> tuple[str, dict]:
        try:
            await asyncio.wait_for(asyncio.to_thread(fn), timeout=_WAIT_TIMEOUT_SECONDS)
            return name, {"status": "up"}
        except TimeoutError:
            return name, {"status": "down", "error": "timeout"}
        except Exception as exc:
            # Type name only — driver error messages can carry the DSN, and this endpoint is unauthenticated.
            return name, {"status": "down", "error": type(exc).__name__}

    async def readiness() -> tuple[bool, dict]:
        results = await asyncio.gather(
            HealthService._probe("mysql", HealthService._check_mysql),
            HealthService._probe("redis", HealthService._check_redis),
            HealthService._probe("qdrant", HealthService._check_qdrant),
            HealthService._probe("minio", HealthService._check_minio),
        )
        dependencies = dict(results)
        ok = all(dep["status"] == "up" for dep in dependencies.values())
        return ok, dependencies
