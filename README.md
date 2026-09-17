# RECALL

[![CI](https://github.com/ArpitRautela/recall/actions/workflows/ci.yml/badge.svg)](https://github.com/ArpitRautela/recall/actions/workflows/ci.yml)

RECALL is a document intelligence platform: upload PDFs and DOCX files, and get a
searchable, chat-with-your-documents knowledge base backed by hybrid (semantic +
keyword) retrieval, source-grounded AI answers, and per-user document organization.

**Backend:** FastAPI · MySQL · Qdrant · MinIO · Celery/Redis
**Frontend:** Next.js · TypeScript · Zustand

Embeddings and reranking run **locally on CPU** — the only paid API in the project
is the chat LLM.

---

## Table of contents

- [What's built](#whats-built)
- [Architecture at a glance](#architecture-at-a-glance)
- [Repository structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Running the app](#running-the-app)
- [Tests](#tests)
- [Continuous integration](#continuous-integration)
- [Database migrations](#database-migrations)
- [API overview](#api-overview)
- [Observability and debugging](#observability-and-debugging)
- [Security posture](#security-posture)
- [Deployment](#deployment)
- [Known gaps](#known-gaps)
- [Further reading](#further-reading)

---

## What's built

Every capability below is implemented and verified end-to-end against the running stack.

| Area | Capability |
|---|---|
| **Accounts** | Register, login (JWT access/refresh), Google OAuth, per-IP login rate limiting, profile management |
| **Workspaces** | Personal document folders, isolated per user; non-empty workspaces can't be deleted; a `Default` workspace is auto-provisioned |
| **Documents** | Upload PDF/DOCX to MinIO with content-sniffed validation and a per-user storage quota; view metadata and status; reprocess; delete |
| **Processing pipeline** | Async (Celery) extraction → page-aware chunking → embedding → vector indexing, tracked as `PENDING → PROCESSING → READY/FAILED` |
| **Retrieval** | Semantic (Qdrant) and lexical (MySQL `FULLTEXT`) search fused by reciprocal rank fusion, then cross-encoder reranked, with workspace / file-type / date filters |
| **Chat** | Multi-turn LangGraph ReAct agent that searches your documents, persisted history, citations carrying the **quoted excerpt** — available both buffered and **streaming over SSE** |
| **AI Search** | Standalone hybrid-search UI over the whole knowledge base, independent of chat |
| **Memories** | Auto-captured activity history (timeline, recent, frequent) — no LLM involved |
| **Command palette** | `⌘K` / `Ctrl+K` jump-to over recent and frequent items |

The models are fixed and pinned: `BAAI/bge-small-en-v1.5` (384-dim embeddings) and
`cross-encoder/ms-marco-MiniLM-L-6-v2` (reranking).

See [`docs/PRD.md`](docs/PRD.md) for the functional requirement list (FR-001–FR-028) this maps to.

---

## Architecture at a glance

```
                     ┌─────────────┐
                     │  Next.js    │  (client components, Zustand auth store)
                     │  Frontend   │
                     └──────┬──────┘
                            │ REST (JWT bearer) + SSE for chat streaming
                     ┌──────▼──────┐
                     │  FastAPI    │  api → service → model, no repository layer
                     │  Backend    │
                     └──┬───┬───┬──┘
                        │   │   │
              ┌─────────┘   │   └─────────┐
              ▼             ▼             ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │  MySQL   │  │  Qdrant  │  │  MinIO   │
        │ metadata │  │ vectors  │  │  files   │
        │ +FULLTEXT│  └──────────┘  └──────────┘
        └──────────┘
              ▲
              │ enqueue / consume
        ┌─────┴─────┐        ┌──────────┐
        │  Celery   │◄───────┤  Redis   │  (broker, result backend,
        │  worker   │        │          │   rate limiting, OAuth codes)
        └───────────┘        └──────────┘
```

MySQL holds relational data (users, documents, workspaces, conversations, messages,
activity events) **and** the raw chunk text used for lexical search. Qdrant holds one
vector per chunk. MinIO holds the original uploaded files. Redis is the Celery
broker/result backend and also backs login rate-limiting and one-time OAuth
exchange codes.

**The API and the worker each load their own copy of both models — roughly 2.5 GB
resident each.** That is the dominant sizing constraint and the reason the design
targets one larger machine rather than many small ones.

The reasoning behind every choice — why MySQL over Postgres, why a local embedding
model instead of a hosted API, why hybrid search is a separate endpoint from chat's
retrieval tool, why there's no repository layer — is written up in
[`docs/BACKEND_DECISIONS.md`](docs/BACKEND_DECISIONS.md) and
[`docs/FRONTEND_DECISIONS.md`](docs/FRONTEND_DECISIONS.md).

---

## Repository structure

```
recall/
├── .github/workflows/ci.yml  # backend tests + frontend typecheck/build on every push
├── backend/
│   ├── app/
│   │   ├── api/v1/          # HTTP routes (auth, documents, workspaces, chat, search, memory, health)
│   │   ├── services/        # business logic (<Entity>Service classes, no `self`)
│   │   ├── models/          # SQLAlchemy models
│   │   ├── schemas/         # Pydantic request models
│   │   ├── core/            # config, DB/Redis/Qdrant/MinIO clients, security, embeddings, reranker, logging
│   │   └── tasks/           # Celery tasks (document processing)
│   ├── alembic/versions/    # hand-reviewed migrations
│   ├── tests/               # pytest, no Docker required
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/(app)/       # authenticated pages: dashboard, vault, chat, search, memories, conversations, settings
│   │   ├── app/(auth)/      # login, register, OAuth callback
│   │   ├── services/        # typed API clients, one file per resource
│   │   ├── stores/          # Zustand auth store
│   │   ├── lib/             # axios instance + refresh interceptor, formatting, error helpers
│   │   ├── components/      # CommandPalette, layout/ (Sidebar, TopBar), ui/ (shadcn primitives)
│   │   └── proxy.ts         # edge auth gate — NOT middleware.ts, see FRONTEND_DECISIONS.md
│   ├── package.json
│   └── Dockerfile
├── docs/                    # PRD, TRD, architecture, deployment, and decision records
├── docker-compose.yml       # datastores by default; app services behind the `full` profile
└── README.md
```

---

## Prerequisites

- **Docker Desktop** — for MySQL, Redis, Qdrant, MinIO
- **Python 3.13** and a virtualenv tool
- **Node.js 20+** and npm
- An **OpenAI API key** — chat uses `gpt-4o-mini`. Embeddings and reranking run
  locally, so they need no key.
- Optionally a **Google OAuth client ID/secret**. Email/password sign-in works without it.

Expect roughly **15 seconds of startup time** on the backend: both models load during
the FastAPI lifespan hook.

---

## Getting started

### 1. Start infrastructure

```bash
docker compose up -d
```

This starts **MySQL, Redis, Qdrant and MinIO only**. The `backend`, `celery_worker`
and `frontend` services sit behind a Compose profile so they stay out of the way
while you run those on the host during development.

To run everything containerised instead (and skip steps 2–3):

```bash
docker compose --profile full up -d
```

> Every published port is bound to `127.0.0.1` on purpose. Docker's default
> `0.0.0.0` binding punches through the host firewall, and **Redis and Qdrant have
> no authentication** — on a machine with a public interface that would expose them.

### 2. Backend setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

pip install -r requirements.txt
```

Create `backend/.env` (see below), then apply migrations:

```bash
python -m alembic upgrade head
```

### 3. Frontend setup

```bash
cd frontend
npm install
```

---

## Environment variables

The backend reads **`backend/.env`** specifically — not a root-level `.env` — via
`app/core/config.py`. Copy the template:

```bash
cp backend/.env.example backend/.env
```

The app **fails fast at startup** if a required secret is missing, rather than
running with an empty one.

```env
# ── Datastores ────────────────────────────────────────────────────────────────
DATABASE_URL=mysql+pymysql://recall:recall@localhost:3306/recall
REDIS_URL=redis://localhost:6379
QDRANT_URL=http://localhost:6333

# ── Object storage ────────────────────────────────────────────────────────────
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=recall
MINIO_SECURE=false

# ── Secrets (required, no defaults) ───────────────────────────────────────────
OPENAI_API_KEY=
JWT_SECRET_KEY=            # python -c "import secrets; print(secrets.token_urlsafe(48))"

# Optional in practice, but config.py requires the keys to exist — set them to
# empty strings rather than deleting the lines.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# ── Optional (defaults shown) ─────────────────────────────────────────────────
JWT_ALGORITHM=HS256
FRONTEND_URL=http://localhost:3000
BACKEND_URL=http://localhost:8000      # builds the Google OAuth redirect URI
STORAGE_QUOTA_BYTES=10737418240        # 10 GB per user, enforced on upload
LOG_LEVEL=INFO
RAG_LOG_LEVEL=INFO                     # see Observability below
```

`BACKEND_URL` matters more than it looks: the Google OAuth redirect is built from
it and must **byte-match** an authorised URI in the Google console. Behind a proxy
the request's own host is not reliable, so it is configured rather than inferred.

The container credentials in `docker-compose.yml` default to the values above and
can be overridden with `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`,
`MYSQL_ROOT_PASSWORD`, `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`. Whatever you
set must match `DATABASE_URL` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`.

**Frontend:** set `NEXT_PUBLIC_API_URL` in `frontend/.env.local` if the backend
isn't on the default `http://localhost:8000/api/v1`. Next.js inlines `NEXT_PUBLIC_*`
at **build** time, so setting it only at runtime has no effect.

---

## Running the app

Three processes, in separate terminals, from `backend/` unless noted:

```bash
# 1. API server
python -m uvicorn app.main:app --reload

# 2. Celery worker (document processing)
#    --pool=solo is a Windows requirement; omit it on macOS/Linux
python -m celery -A app.core.celery_app worker --pool=solo --loglevel=info

# 3. Frontend, from frontend/
npm run dev
```

The app is then at `http://localhost:3000`, calling the API at `http://localhost:8000/api/v1`.

All three are **long-lived servers**. They block on I/O waiting for work and never
exit on their own; stopping one is how you end it.

---

## Tests

```bash
cd backend
pytest
```

**61 tests.** They run against in-memory SQLite with MinIO, Qdrant, Redis and Celery
patched out, so **no Docker is required** and no model is loaded.

| File | Covers |
|---|---|
| `test_security.py` | JWT handling (including `alg=none` forgery), login rate limiting |
| `test_upload_validation.py` | Magic-byte content sniffing, storage-quota enforcement |
| `test_documents.py` | Document lifecycle and per-user isolation |
| `test_health.py` | Liveness and readiness probe behaviour |
| `test_memory.py` | Activity endpoints and per-user scoping |

Chat, search and the document-processing task are still verified by hand against
the real stack — see [Known gaps](#known-gaps).

---

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull
request, as two parallel jobs:

| Job | Does |
|---|---|
| **Backend tests** | Installs CPU-only torch (the default CUDA wheel is gigabytes and pointless on a runner), then `pytest` |
| **Frontend typecheck and build** | `tsc --noEmit`, then `next build` |

In-flight runs for the same ref are cancelled when you push again. The backend job
supplies dummy values for every required environment variable, since `config.py`
refuses to start without them.

---

## Database migrations

```bash
cd backend
python -m alembic upgrade head                 # apply pending migrations
python -m alembic current                      # check what's applied
python -m alembic revision -m "description"    # create a stub
```

There are **two** migrations: the initial schema and `activity_events`. The original
seven incremental migrations were squashed into the initial one.

**Migrations that add a required column to a populated table, or otherwise backfill
data, are written by hand** — never `--autogenerate`d. MySQL's DDL is not
transactional: each statement auto-commits independently, so a failure halfway
through leaves the schema partly changed with no rollback. Autogenerate also has no
concept of backfilling. See [`docs/BACKEND_DECISIONS.md`](docs/BACKEND_DECISIONS.md)
§6 for the pattern. **Take a `mysqldump` backup before any migration that touches
existing data.**

---

## API overview

All routes are prefixed `/api/v1` and require `Authorization: Bearer <access_token>`,
except `/auth/login`, `/auth/register`, `/auth/refresh` and the Google OAuth routes.

| Router | Endpoints |
|---|---|
| `/auth` | `POST /register`, `POST /login`, `POST /refresh`, `GET /me`, `PATCH /me`, `POST /logout`, `GET /google`, `GET /google/callback`, `POST /exchange` |
| `/workspaces` | `POST /`, `GET /`, `DELETE /{id}` |
| `/documents` | `POST /upload`, `GET /`, `GET /usage`, `GET /{id}`, `GET /{id}/chunks`, `POST /{id}/reprocess`, `DELETE /{id}` |
| `/chat` | `POST /`, `POST /stream`, `GET /conversations`, `GET /conversations/{id}` |
| `/search` | `POST /` — hybrid semantic + lexical search with metadata filters |
| `/memory` | `GET /timeline`, `GET /recent`, `GET /frequent` |

`POST /chat/stream` returns **Server-Sent Events**, emitting `meta`, `searching`,
`sources`, `token`, `done` and `error` frames. `POST /chat/` is the buffered
equivalent; both share the same turn preparation and persistence code.

Two routes sit outside `/api/v1` and take no authentication, since an orchestrator
has no bearer token:

| Route | Purpose |
|---|---|
| `GET /health` | **Liveness** — always 200, never touches a dependency, so a Redis blip can't get a healthy container restarted. Point restart probes here. |
| `GET /health/ready` | **Readiness** — probes MySQL, Redis, Qdrant and MinIO concurrently; 200 `ready`, or 503 `degraded` naming the failing dependency. Point load-balancer routing here. |

Readiness reports only the **exception type**, never the message — the endpoint is
unauthenticated and driver errors leak DSNs.

Interactive OpenAPI docs: `http://localhost:8000/docs` while the backend runs.

---

## Observability and debugging

Logging is configured in `app/core/logging_config.py`. Two independent levels:

- **`LOG_LEVEL`** — application-wide. httpx and qdrant-client are deliberately quietened.
- **`RAG_LOG_LEVEL`** — the `recall.rag` logger, separate so you can turn retrieval
  diagnostics up without drowning in HTTP noise.

At `INFO`, every retrieval emits one line carrying a named outcome, the best rerank
score, and **`short_by`** — how far the best candidate fell below the acceptance
threshold. That last field is the one that matters: it distinguishes "nothing
relevant exists" from "the threshold is mistuned". At `DEBUG` you additionally get a
line per candidate showing what was kept or dropped and why.

The reranker emits **raw cross-encoder logits**, not probabilities. The acceptance
threshold is `-4.0`, derived from measurement rather than intuition — the worst
true hit scored `-3.13` and the best true miss `-5.59`. If you change the reranker
model, that number has to be re-derived.

Measured warm CPU latency, median of three: embed **18 ms**, Qdrant **~2.1 s**,
rerank of 20 candidates **~1.3 s**. Cold numbers are much worse and not
representative — warm the models before benchmarking anything.

---

## Security posture

What is in place:

- **JWT** access/refresh with algorithm pinning; `alg=none` forgery is covered by tests.
- **bcrypt** password hashing.
- **Per-IP login rate limiting** backed by Redis — 5 attempts per 15-minute
  window, answered with 429 and a `Retry-After` header.
- **Content-sniffed upload validation** — files are identified by magic bytes
  (`%PDF-`; DOCX as a zip containing a `word/` part), never by the client-supplied
  `Content-Type`, which is trivially forged.
- **Per-user storage quota**, enforced on upload, returning 507.
- **One-time OAuth exchange codes** with a 30-second TTL — JWTs never appear in URLs.
- **Loopback-bound datastore ports** in Compose.
- **No `dangerouslySetInnerHTML`** in chat rendering; model output is rendered as
  React nodes, closing a stored-XSS path.

Known exposure: **`transformers` is pinned to 4.57.6** with open advisories.
Upgrading is blocked — `sentence-transformers` requires `<5.0.0`, `optimum-onnx`
requires `<4.58.0`, and 5.x removes `is_offline_mode`, which `optimum.onnxruntime`
imports, so the reranker fails to load. Exposure is limited because only fixed,
pinned models are ever loaded. See the rationale block in `backend/requirements.txt`.

---

## Deployment

See **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** for the full guide and release
checklist. The essentials:

- The platform must **terminate TLS**. JWTs travel in the `Authorization` header and
  are readable in transit over plain HTTP. The app does not terminate TLS itself.
- The API must run with **`--proxy-headers`** (the Dockerfile's `CMD` already does).
  Without it every request appears to originate from the proxy, and the per-IP login
  rate limiter would lock out **all** users after five failed attempts from anyone.
- Datastores must be on **private networking**. Redis and Qdrant have no authentication.
- **Regenerate every secret.** The values in `docker-compose.yml` are development
  defaults and are public in this repository.

---

## Known gaps

Deliberately deferred, not overlooked:

- **No RBAC** — workspaces are single-owner; there is no sharing.
- **No audit log.**
- **No password reset** — a PRD user story with no endpoint; it needs an email
  provider decision first.
- **No account deletion**, and no delete-conversation.
- **No metrics/tracing stack** — no Prometheus, Grafana or distributed tracing.
  The `infrastructure/` directory is an empty placeholder.
- **Retrieval latency ~1.3 s** against the TRD's 500 ms target, dominated by CPU
  reranking. A GPU instance is the realistic fix; this is a deliberate cost trade.
- **Test coverage is partial** — 57% overall, with `chatService` at 23% and
  `searchService` at 28%. Chat and search are verified manually against the real stack.
- **Scanned PDFs index as junk.** Extraction is text-layer only; there is no OCR, so
  an image-only PDF produces chunks of page furniture. Check `GET /{id}/chunks`
  after uploading anything scanned.

---

## Further reading

| Doc | Contents |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Product requirements — goals, users, FR-001–FR-028 |
| [`docs/TRD.md`](docs/TRD.md) | Technical requirements and constraints |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Deploying to a PaaS, with a release checklist |
| [`docs/DOCUMENT_PROCESSING.md`](docs/DOCUMENT_PROCESSING.md) | The ingestion pipeline end to end |
| [`docs/BACKEND_DECISIONS.md`](docs/BACKEND_DECISIONS.md) | Every backend decision, with reasoning and deviations from `ARCHITECTURE.md` |
| [`docs/FRONTEND_DECISIONS.md`](docs/FRONTEND_DECISIONS.md) | Every frontend decision, same |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The *originally planned* structure — the built system deviates |
| [`docs/HLD.md`](docs/HLD.md) | High-level design — **stale** |

> **Doc precedence:** where documents disagree, trust this README and the two
> `*_DECISIONS.md` files. `HLD.md` and `TRD.md` §11 still describe PostgreSQL; the
> system uses MySQL. `ARCHITECTURE.md` describes the planned layout, not the built one.
