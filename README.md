# RECALL

RECALL is a document intelligence platform: upload PDFs and DOCX files, and get a searchable, chat-with-your-documents knowledge base backed by hybrid (semantic + keyword) retrieval, source-grounded AI answers, and per-user document organization.

Backend: FastAPI + MySQL + Qdrant + MinIO + Celery/Redis. Frontend: Next.js + TypeScript + Zustand.

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
- [Database migrations](#database-migrations)
- [API overview](#api-overview)
- [Known gaps / explicitly out of scope](#known-gaps--explicitly-out-of-scope)
- [Further reading](#further-reading)

---

## What's built

All functional requirements below are implemented and verified end-to-end against the running stack.

| Area | Capability |
|---|---|
| **Accounts** | Register, login (JWT access/refresh), Google OAuth, rate-limited login, profile management (rename, change password) |
| **Workspaces** | Create/delete personal document folders, isolated per user, non-empty workspaces can't be deleted, a `Default` workspace is auto-provisioned |
| **Documents** | Upload PDF/DOCX (to MinIO), view metadata and processing status, delete, **reprocess** a failed/stale document |
| **Processing pipeline** | Async (Celery) text extraction, page-aware chunking, embedding generation, vector indexing — status tracked as `PENDING → PROCESSING → READY/FAILED` |
| **Retrieval** | Semantic (vector) search, lexical (MySQL `FULLTEXT`) search, **hybrid** search (reciprocal rank fusion of both), metadata filtering (workspace / file type / date range), cross-encoder reranking |
| **Chat** | Multi-turn conversations with a LangGraph ReAct agent that searches the user's documents, persisted history, source citations **with the actual quoted excerpt**, not just a filename |
| **AI Search** | Standalone hybrid-search UI over the whole knowledge base, independent of chat, with real filters |

See [`docs/PRD.md`](docs/PRD.md) for the full functional requirement list (FR-001–FR-028) this maps to.

---

## Architecture at a glance

```
                     ┌─────────────┐
                     │  Next.js    │  (client components, Zustand auth store)
                     │  Frontend   │
                     └──────┬──────┘
                            │ REST (JWT bearer)
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
        │ + FULLTEXT│  └──────────┘  └──────────┘
        └──────────┘
              ▲
              │ enqueue / consume
        ┌─────┴─────┐        ┌──────────┐
        │  Celery   │◄───────┤  Redis   │  (broker, result backend,
        │  worker   │        │          │   rate limiting, OAuth codes)
        └───────────┘        └──────────┘
```

MySQL holds relational data (users, documents, workspaces, conversations, messages) **and** the raw chunk text used for lexical search. Qdrant holds one vector per chunk. MinIO holds the original uploaded files. Redis is the Celery broker/result backend and also backs login rate-limiting and one-time OAuth exchange codes.

The full reasoning behind every one of these choices — why MySQL over Postgres, why a local embedding model instead of a hosted API, why hybrid search is a separate endpoint from chat's retrieval tool, why there's no repository layer, etc. — is written up in:

- [`docs/BACKEND_DECISIONS.md`](docs/BACKEND_DECISIONS.md)
- [`docs/FRONTEND_DECISIONS.md`](docs/FRONTEND_DECISIONS.md)

---

## Repository structure

```
recall/
├── backend/
│   ├── app/
│   │   ├── api/v1/          # HTTP routes (auth, documents, workspaces, chat, search)
│   │   ├── services/        # business logic (<Entity>Service classes, no `self`)
│   │   ├── models/          # SQLAlchemy models
│   │   ├── schemas/         # Pydantic request models
│   │   ├── core/            # config, DB/Redis/Qdrant/MinIO clients, security, embeddings, reranker
│   │   └── tasks/           # Celery tasks (document processing)
│   ├── alembic/versions/    # hand-reviewed, hand-written-when-backfilling migrations
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/(app)/       # authenticated pages: dashboard, vault, chat, search, settings, conversations
│   │   ├── app/(auth)/      # login, register, OAuth callback
│   │   ├── services/        # typed API clients, one file per resource
│   │   ├── stores/          # Zustand auth store
│   │   ├── lib/             # axios instance + refresh interceptor, formatting, error helpers
│   │   ├── components/layout/  # Sidebar, TopBar (the only shared components in active use)
│   │   └── proxy.ts         # edge auth gate — NOT middleware.ts, see FRONTEND_DECISIONS.md
│   ├── package.json
│   └── Dockerfile
├── docs/                    # PRD, TRD, architecture, and decision records (this file's siblings)
├── docker-compose.yml       # infra only: mysql, redis, qdrant, minio
└── README.md
```

---

## Prerequisites

- **Docker Desktop** (for MySQL, Redis, Qdrant, MinIO)
- **Python 3.13** and a virtualenv tool
- **Node.js 20+** and npm
- An **OpenAI API key** (chat uses `gpt-4o-mini`; embeddings and reranking run locally, no API key needed for those)
- Optionally, a **Google OAuth client ID/secret** if you want Google sign-in — the app also works with plain email/password without it

---

## Getting started

### 1. Start infrastructure

```bash
docker compose up -d
```

This starts **MySQL, Redis, Qdrant, and MinIO** only — the `backend`, `celery_worker` and `frontend` services are behind a Compose profile, so they stay out of the way while you run those two on the host during development.

To run everything containerised instead (and skip steps 2-3 below):

```bash
docker compose --profile full up -d
```

### 2. Backend setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

pip install -r requirements.txt
```

Create `backend/.env` (see [Environment variables](#environment-variables) below), then apply migrations:

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

The backend reads **`backend/.env`** specifically (not a root-level `.env`), via `app/core/config.py`. Copy the template to get started:

```bash
cp backend/.env.example backend/.env
```

All of these are required unless noted — the app fails fast at startup if a secret is missing rather than running with an empty one:

```env
DATABASE_URL=mysql+pymysql://recall:recall@localhost:3306/recall
REDIS_URL=redis://localhost:6379
QDRANT_URL=http://localhost:6333
OPENAI_API_KEY=

JWT_SECRET_KEY=
JWT_ALGORITHM=HS256                    # optional, defaults to HS256
FRONTEND_URL=http://localhost:3000     # optional, defaults shown

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=recall
MINIO_SECURE=false                     # optional, defaults to false

STORAGE_QUOTA_BYTES=10737418240        # optional, defaults to 10GB per user
```

The `MYSQL_*`/`MINIO_ROOT_*` credentials for the containers themselves are set directly in `docker-compose.yml`, and should match what you put in `DATABASE_URL`/`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` above.

Frontend: optionally set `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8000/api/v1`) in `frontend/.env.local` if the backend isn't on the default host/port.

---

## Running the app

Three processes, in separate terminals, from `backend/` unless noted:

```bash
# 1. API server
python -m uvicorn app.main:app --reload

# 2. Celery worker (document processing)
# --pool=solo is required on Windows; omit it on macOS/Linux
python -m celery -A app.core.celery_app worker --pool=solo --loglevel=info

# 3. Frontend, from frontend/
npm run dev
```

The app is then available at `http://localhost:3000`, proxying API calls to `http://localhost:8000/api/v1`.

---

## Tests

```bash
cd backend
pytest
```

They run against in-memory SQLite with MinIO, Qdrant, Redis and Celery patched out, so **no Docker is required**. Coverage is deliberately narrow — storage-quota enforcement, per-user isolation on the memory endpoints, health-probe behaviour, and upload validation. Integration with the real services is still verified by hand.

---

## Database migrations

```bash
cd backend
python -m alembic upgrade head      # apply all pending migrations
python -m alembic current           # check what's applied
python -m alembic revision -m "description"   # create a new migration stub
```

There are currently **two** migrations: an initial schema and `activity_events`. The original seven incremental migrations were squashed into the initial one before any database had applied them.

**Migrations that add a required column to a populated table, or otherwise need to backfill data, are written by hand** — never `--autogenerate`d — because MySQL's DDL is not transactional (each statement auto-commits independently) and autogenerate has no concept of backfilling data. See [`docs/BACKEND_DECISIONS.md`](docs/BACKEND_DECISIONS.md) (section 6) for the exact pattern used. Take a `mysqldump` backup before running any migration that touches existing data.

---

## API overview

All routes are prefixed `/api/v1`. Every route except `/auth/login`, `/auth/register`, `/auth/refresh`, and the Google OAuth routes requires a `Authorization: Bearer <access_token>` header.

| Router | Endpoints |
|---|---|
| `/auth` | `POST /register`, `POST /login`, `POST /refresh`, `GET /me`, `PATCH /me`, `POST /logout`, `GET /google`, `GET /google/callback`, `POST /exchange` |
| `/workspaces` | `POST /`, `GET /`, `DELETE /{id}` |
| `/documents` | `POST /upload`, `GET /`, `GET /usage`, `GET /{id}`, `GET /{id}/chunks`, `POST /{id}/reprocess`, `DELETE /{id}` |
| `/chat` | `POST /`, `GET /conversations`, `GET /conversations/{id}` |
| `/search` | `POST /` — hybrid semantic + lexical search with metadata filters |
| `/memory` | `GET /timeline`, `GET /recent`, `GET /frequent` — auto-captured activity history |

Two further routes sit outside `/api/v1` and take no authentication, since an orchestrator has no bearer token:

| Route | Purpose |
|---|---|
| `GET /health` | Liveness — always 200, never touches a dependency, so a Redis blip can't get a healthy container restarted |
| `GET /health/ready` | Readiness — probes MySQL, Redis, Qdrant and MinIO concurrently; 200 `ready` or 503 `degraded` with per-dependency status |

Interactive OpenAPI docs are available at `http://localhost:8000/docs` while the backend is running.

---

## Known gaps / explicitly out of scope

These were deliberately deferred, not overlooked — see the PRD's non-functional requirements and the project's cost/complexity priorities:

- **RBAC** — no roles/permissions system; workspaces are single-owner only, not shared
- **TLS** — no HTTPS termination configured for local dev
- **Audit logging** — no append-only action log
- **Observability** — no metrics/tracing/alerting stack (Prometheus/Grafana directories exist under `infrastructure/` but are unpopulated)
- **Production deployment** — `Dockerfile`s are wired into `docker-compose.yml` behind the `full` profile, but there's no CI/CD or hosting config yet
- **Test coverage is partial** — `backend/tests/` covers the storage quota, memory endpoints and health probes (run `pytest` from `backend/`), but auth, chat, search and the document-processing task are still only verified manually, plus `tsc --noEmit` on the frontend

---

## Further reading

| Doc | Contents |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Product requirements — goals, users, full FR-001–FR-028 list |
| [`docs/TRD.md`](docs/TRD.md) | Technical requirements and constraints |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The original planned repository/module structure |
| [`docs/BACKEND_DECISIONS.md`](docs/BACKEND_DECISIONS.md) | Every backend architectural decision made, with reasoning, and where the built system deviated from `ARCHITECTURE.md` and why |
| [`docs/FRONTEND_DECISIONS.md`](docs/FRONTEND_DECISIONS.md) | Every frontend architectural decision made, with reasoning, and where the built system deviated from `ARCHITECTURE.md` and why |
