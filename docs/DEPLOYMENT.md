# Deployment

Written for a PaaS (Railway, Render, Fly.io) where the platform terminates TLS.
For a self-managed VPS the same requirements apply, but you supply the reverse
proxy and certificates yourself.

---

## What the platform must provide

| Requirement | Why |
|---|---|
| **TLS termination** | JWTs travel in the `Authorization` header. Over plain HTTP they are readable in transit. The app does not terminate TLS itself. |
| **`X-Forwarded-*` headers** | The backend runs with `--proxy-headers`. Without them every request appears to come from the proxy, and the login rate limiter — which is per-IP — would lock out all users after five failed attempts from anyone. |
| **Private networking to datastores** | MySQL, Redis, Qdrant and MinIO must not be publicly reachable. Redis and Qdrant have no authentication. |

---

## Services to run

Five processes, plus four datastores:

| Service | Command | Notes |
|---|---|---|
| API | `uvicorn app.main:app --proxy-headers ...` | The Dockerfile's `CMD` already does this and honours `$PORT` |
| Worker | `celery -A app.core.celery_app worker` | Drop `--pool=solo`; that is a Windows-only workaround |
| Frontend | `npm start` | After `npm run build` |
| MySQL 8 | managed service | |
| Redis | managed service | broker, rate limits, OAuth codes |
| Qdrant | container or Qdrant Cloud | |
| MinIO or S3 | | MinIO speaks the S3 API, so either works |

The API and worker both load an embedding model and a reranker — roughly
**2.5 GB resident each**. Size instances accordingly; this is the main cost
driver and the reason the TRD targets a single larger machine rather than many
small ones.

---

## Environment

Start from `backend/.env.example` — it lists every setting. These differ from
local development:

```env
# Public origins. BACKEND_URL builds the Google OAuth redirect and must byte-match
# an authorised URI in the Google console. FRONTEND_URL is the single allowed CORS
# origin and the post-login redirect target.
BACKEND_URL=https://api.your-domain.com
FRONTEND_URL=https://your-domain.com

# Generate, never reuse the dev value:
#   python -c "import secrets; print(secrets.token_urlsafe(48))"
JWT_SECRET_KEY=

# Private hostnames from the platform, not localhost.
DATABASE_URL=mysql+pymysql://user:password@db-host:3306/recall
REDIS_URL=redis://redis-host:6379
QDRANT_URL=http://qdrant-host:6333
MINIO_ENDPOINT=storage-host:9000
MINIO_SECURE=true
```

The frontend needs `NEXT_PUBLIC_API_URL=https://api.your-domain.com/api/v1` **at
build time** — Next.js inlines `NEXT_PUBLIC_*` into the bundle, so setting it only
at runtime has no effect.

---

## Release checklist

**Before the first deploy**

- [ ] Every secret regenerated — `JWT_SECRET_KEY`, database and object-storage credentials. The values in `docker-compose.yml` are development defaults and are public in this repository.
- [ ] Datastores reachable only over private networking.
- [ ] `https://api.your-domain.com/api/v1/auth/google/callback` added as an authorised redirect URI in the Google console, and `https://your-domain.com` as an authorised origin.
- [ ] `alembic upgrade head` run against the production database.
- [ ] `BACKEND_URL` and `FRONTEND_URL` set to real origins.

**Verify after deploying**

- [ ] `GET /health` returns 200.
- [ ] `GET /health/ready` returns 200 with all four dependencies `up`. A 503 names which one is unreachable.
- [ ] Register, log in, and complete a Google sign-in — the OAuth redirect is the most deployment-sensitive path.
- [ ] Upload a document and confirm it reaches `READY`; that exercises MinIO, Celery, Qdrant and MySQL together.
- [ ] Ask a question in chat and confirm the answer carries citations.

**Operational notes**

- `/health` is liveness — it never touches a dependency, so use it for restart probes. `/health/ready` is readiness; use it for load-balancer routing. Pointing restarts at readiness would kill healthy containers during a brief Redis blip.
- Startup takes roughly 15 seconds because both models load during the lifespan hook. Set startup probe timeouts above that.
- `RAG_LOG_LEVEL=DEBUG` logs a line per retrieval candidate when answers look wrong.

---

## Known gaps at first release

These are deliberate and documented in the README; none are blocking, but be
aware of them:

- **No RBAC** — workspaces are single-owner; there is no sharing.
- **No audit log.**
- **No password reset** — a PRD user story with no endpoint; it needs an email provider decision.
- **No account deletion.**
- **Retrieval latency ~1.3s** against the TRD's 500 ms target, dominated by CPU reranking. A GPU instance is the realistic fix.
- **`transformers` is pinned to 4.57.6** with open advisories. Upgrading is blocked: `sentence-transformers` requires `<5.0.0` and `optimum-onnx` requires `<4.58.0`, and 5.x removes an API `optimum.onnxruntime` imports, so the reranker fails to load. Exposure is limited because only fixed, pinned models are ever loaded.
