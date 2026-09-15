# Backend Design Decisions

This document records every architectural and implementation decision made while building RECALL's backend, in the order the system was actually built, with the reasoning behind each one. It reflects what was actually built, not the original aspirational design in `ARCHITECTURE.md` (see "Deviations from the original architecture plan" at the end).

It's organized into the phases the backend was actually built in: foundational stack choices, accounts, document storage, async processing, retrieval/chat, retrieval quality, workspaces, and the final round of feature completion (profile management, reprocessing, citation excerpts, hybrid search).

---

## Phase 0 — Foundational stack choices

### 0.1 Framework & language

**Decision:** FastAPI (0.138.2) on Python 3.13, ASGI via Uvicorn.

**Why:** Native async support for I/O-bound work (DB, Qdrant, MinIO, OpenAI calls), automatic OpenAPI docs, and Pydantic-based validation for free. FastAPI's dependency-injection system (`Depends`) gives a clean way to share DB sessions and auth without a heavier framework.

### 0.2 Service-class convention (no `self`)

**Decision:** Business logic lives in classes named `<Entity>Service` (e.g. `DocumentService`, `WorkspaceService`), but methods are defined **without `self`** and called directly on the class: `DocumentService.get_by_id(db, id, user_id)`.

**Why:** These services are stateless — every method takes the DB session and any IDs it needs as explicit arguments. Using `self` would imply instance state that never exists, so the classes exist purely as namespaces. This also makes call sites read like static utility calls, which matches how they're used (never instantiated, never subclassed). This convention was set with the very first service (`AuthService`) and followed exactly by every service written afterward (`DocumentService`, `ChatService`, `WorkspaceService`, `SearchService`), with no exceptions.

### 0.3 Layering: API → Service → Model, no repository layer

**Decision:** Three layers, not four:
- `app/api/v1/*.py` — HTTP concerns only (auth dependency, request/response shape, status codes).
- `app/services/*.py` — business rules, orchestration across MySQL/Qdrant/MinIO/Celery.
- `app/models/*.py` — SQLAlchemy ORM entities, queried directly by services.

**Why:** The original plan (`ARCHITECTURE.md`) called for a separate repository layer between services and models. In practice, every query turned out simple enough (filtered by `user_id`, sometimes joined once) that a repository layer would just forward calls to SQLAlchemy with no abstraction benefit — extra indirection with no payoff. Services query `db.query(Model)...` directly. If query complexity grows later (e.g. real full-text ranking tuning, complex joins), a repository layer can be introduced then, not speculatively now.

### 0.4 Database: MySQL 8 + SQLAlchemy 2.0 (raw `Column()`, not `Mapped[]`) + Alembic

**Decision:** MySQL for all relational data, using SQLAlchemy's classic `Column()` declarative style rather than the newer `Mapped[]`/`mapped_column()` typed style, with Alembic for migrations.

**Why:** MySQL is free, self-hostable, and the team's baseline relational store — no reason to introduce Postgres just for this project. Classic `Column()` style was chosen for consistency with the very first model written (`User`) and kept for every model afterward, because the extra type-checking `Mapped[]` gives wasn't worth a mid-project style change once established.

**Consequence — MySQL DDL is not transactional.** Every `ALTER TABLE`/`CREATE TABLE` auto-commits independently; a failed migration midway through does not roll back earlier statements in the same script. This shaped two concrete migration decisions, applied consistently across all seven migrations written for this project:
- Migrations that backfill data (e.g. adding `documents.workspace_id` to a populated table) are **hand-written**, not `--autogenerate`d, and every backfill `UPDATE`/`INSERT` is written to be idempotent (`WHERE NOT EXISTS`, `WHERE col IS NULL`) so a retry after a partial failure doesn't duplicate or corrupt data.
- A `mysqldump` backup is taken before running any migration that touches existing data, since `downgrade()` is not a reliable safety net here.

### 0.5 Environment configuration: `pydantic-settings`, one `.env`, no defaults for secrets

**Decision:** All configuration is centralized in `app/core/config.py` via a single `Settings(BaseSettings)` class reading one `.env` file at `backend/.env`. Secrets (`OPENAI_API_KEY`, `JWT_SECRET_KEY`, `GOOGLE_CLIENT_SECRET`, MinIO keys) have **no default value** — the app fails to start if they're missing, rather than silently running with an empty/placeholder secret.

**Why:** Failing loudly at startup on a missing secret is far cheaper to debug than a JWT silently signed with an empty string, or a Google OAuth flow that fails cryptically at request time. This was decided before any route was built, since every subsequent module (`security.py`, `qdrant_client.py`, `minio_client.py`, `celery_app.py`) reads from this one `settings` object.

---

## Phase 1 — Accounts & authentication

This was the first working vertical slice: register, login, and a way to identify "whose request is this."

### 1.1 Auth: JWT access/refresh pair, bcrypt, optional Google OAuth

**Decision:** Stateless JWTs — 30-minute access tokens, 7-day refresh tokens, both HS256-signed. Passwords are bcrypt-hashed. Google OAuth is supported as an alternative sign-in path (`google_id` nullable on `User`, `password` nullable to allow OAuth-only accounts), exchanged through a short-lived (30s) one-time code in Redis rather than ever putting a JWT in a redirect URL.

**Why stateless JWT over server-side sessions:** no session store to scale or invalidate across processes; trade-off accepted is that logout is client-side-only (token discarded, not blacklisted) — acceptable for the current scope, with a Redis blacklist noted as the addition point if revocation becomes a real requirement.

**Why the OAuth code goes through Redis instead of the URL:** a JWT embedded in a redirect URL ends up in browser history, server logs, and the `Referer` header — a one-time opaque code with a 30-second TTL avoids all of that exposure. `AuthService.handle_google_callback` links to an existing account by email if one exists (rather than erroring "account already exists"), so a user who registered with a password can later also sign in with Google on the same email without creating a duplicate account.

**Login rate limiting:** 5 failed attempts per IP per 15-minute window, tracked in Redis (`check_rate_limit`/`reset_rate_limit` in `security.py`), resetting on a successful login. **Login and password-change both use a uniform failure message** ("Invalid credentials" / "Current password is incorrect") regardless of *which* check failed (wrong email vs. wrong password), so a response never confirms whether an email exists or how close an attacker got.

### 1.2 Ownership check pattern: 404, never 403

**Decision:** Every "fetch a resource that belongs to a user" lookup (`DocumentService.get_by_id`, `WorkspaceService.get_by_id`, conversation lookups in `ChatService`) filters by **both** the resource ID and `user_id` in the same query, and raises `404 Not Found` if the row doesn't match — whether the resource doesn't exist at all, or exists but belongs to someone else.

**Why:** Returning `403 Forbidden` for "exists but not yours" leaks the existence of another user's resource (their document ID, workspace ID, conversation ID) to an attacker who's just probing IDs. A uniform 404 gives no signal either way. This pattern was set the moment the second resource type (documents) needed ownership checks, and has been applied without exception to every resource added since (workspaces, conversations).

### 1.3 Schema files: one PascalCase file per request model

**Decision:** `app/schemas/` holds one file per Pydantic model, named after the class (`RegisterRequest.py`, `LoginRequest.py`, later `ChatRequest.py`, `WorkspaceRequest.py`, `SearchRequest.py`, `ProfileUpdateRequest.py`), each with `@field_validator`s for basic input hygiene (non-blank strings, length limits) rather than relying on the DB to reject bad data.

**Why:** Keeps request contracts easy to locate (filename == class name), and validation errors surface as clean 422s before touching the database, rather than as a MySQL constraint violation. This convention started with `RegisterRequest`/`LoginRequest` and was reused unchanged for every request model added in later phases.

---

## Phase 2 — Document upload & storage

The next vertical slice: let a user get a file into the system at all, before anything reads it.

### 2.1 Upload validation: MIME allowlist + hard size cap, rejected before storage

**Decision:** `DocumentService.upload_to_minio` only accepts `application/pdf` and the DOCX MIME type (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`), rejecting anything else with `415 Unsupported Media Type`, and enforces a 50MB hard cap (`413 Request Entity Too Large`) — checked **after** reading the file into memory but **before** any MinIO `put_object` call.

**Why an allowlist instead of a blocklist:** an allowlist can't be bypassed by a file extension/MIME type nobody thought to blocklist yet — only the two formats the processing pipeline (Phase 3) actually knows how to parse are accepted at all. **Why 50MB:** large enough for real-world PDFs (a few hundred pages of text) while keeping a single upload's memory footprint (the whole file is read into memory as `bytes` before streaming to MinIO) and worst-case Celery processing time bounded.

### 2.2 Document storage split: MinIO (blobs) + MySQL (metadata) + Qdrant (vectors, added in Phase 3)

**Decision:** Each store does the one thing it's good at:
- **MinIO** — the actual PDF/DOCX file bytes, addressed by `documents.minio_key` (`{user_id}/{uuid4().hex}{ext}`).
- **MySQL** — document metadata and processing status.
- **Qdrant** — (added once processing existed) one vector per chunk.

**Why MinIO over a cloud object store (S3):** chosen specifically to stay self-hosted and free during development, per the project's cost-guardian priority — swapping to S3 later only requires changing the client config, since MinIO speaks the S3 API. **Why the key is `{user_id}/{uuid4}{ext}` and not the original filename:** avoids any collision between two different users' (or the same user's) identically-named files, and avoids ever trusting user-supplied text as part of a storage path.

### 2.3 Document status as an explicit state machine

**Decision:** `Document.status` is a four-value enum — `PENDING → PROCESSING → READY` or `FAILED` — stored as a real DB enum column (not a free-text string), with `error_message` only ever populated on `FAILED` and cleared (`None`) on every new processing attempt.

**Why an explicit enum over, say, a boolean `is_ready` flag:** the frontend (Vault page) needs to distinguish "still uploading," "actively being processed," and "processing failed with a reason" as genuinely different UI states (spinner vs. badge vs. error message) — collapsing that into a boolean would lose information the UI actually uses. This state machine was designed once, at upload time, and every later feature (reprocessing) was built to reuse the exact same four states rather than inventing a fifth.

### 2.4 New non-nullable columns on populated tables

**Decision:** When a later feature needs to add a required column to a table that already has rows (this first came up adding `documents.workspace_id` in Phase 6), the migration always: (1) adds the column nullable, (2) backfills every existing row, (3) *then* alters it to `NOT NULL`. `server_default` is used wherever a static default is semantically correct (e.g. `workspaces.is_default` defaults to `0`); a real backfill query is used where the correct value differs per row (e.g. each user's own auto-created "Default" workspace).

**Why:** MySQL will reject `ADD COLUMN ... NOT NULL` outright on a non-empty table unless every existing row already has a value, and Alembic's autogenerate doesn't know how to backfill — it only knows schema shape, not data. This has to be done by hand every time a required, no-sensible-default column is added to live data (see Phase 0.4).

---

## Phase 3 — Async document processing pipeline

Once a file could be stored, it needed to become searchable: extract text, chunk it, embed it, index it.

### 3.1 Async processing via Celery + Redis, not inline

**Decision:** `POST /documents/upload` stores the file and metadata, returns `202 Accepted` immediately, and hands off text extraction → chunking → embedding → indexing to a Celery task (`app.tasks.document_processor.process_document`) queued through Redis.

**Why:** Embedding a 100-page PDF can take seconds; doing it inline would block the request past any reasonable timeout and tie up a web worker. Celery lets the upload endpoint stay fast and lets processing scale independently (more workers, not more web servers) as document volume grows.

### 3.2 Chunking strategy

**Decision:** `RecursiveCharacterTextSplitter` (LangChain) with a 512-token chunk size, 50-token overlap, measured via the `cl100k_base` tiktoken encoding — applied per-page for PDFs (so `page_number` stays attached to each chunk) and over the whole document for DOCX (which has no native page concept, so `page_number` is `None` for DOCX chunks).

**Why:** Token-based sizing (not character count) keeps chunks aligned with what the embedding model and LLM context window actually consume. The overlap prevents a sentence that straddles a chunk boundary from losing context in both halves. Chunking per-page for PDFs is what makes page-number citations possible later in chat and search — this was a deliberate choice made at pipeline design time specifically to enable that later feature, not an accident of how PyMuPDF happens to expose pages.

### 3.3 Embeddings: local, free, self-hosted model

**Decision:** `BAAI/bge-small-en-v1.5` via `sentence-transformers`, run locally on CPU (384-dim output, matching `VECTOR_SIZE` in Qdrant), normalized embeddings for cosine similarity.

**Why:** Directly follows the project's cost-guardian priority — a local embedding model has zero marginal API cost regardless of document volume, versus paying per-token for a hosted embeddings API. `bge-small` was chosen over larger BGE variants as the right size/quality tradeoff for a small-English-corpus RAG use case running on commodity CPU hardware, not GPU infrastructure.

### 3.4 Deterministic Qdrant point IDs

**Decision:** Every chunk's Qdrant point ID is `uuid5(NAMESPACE, f"{document_id}:{chunk_index}")` — a deterministic UUID derived from the document ID and chunk index, not a random `uuid4()`.

**Why:** This makes re-processing the same document idempotent at the vector-storage level: reprocessing document 42 always regenerates the exact same point IDs for its chunks, so an `upsert` naturally replaces the old vectors in place instead of leaving orphaned points with new random IDs floating in the collection alongside the new ones. Combined with `_wipe_existing` explicitly deleting-by-`document_id` before re-inserting (belt-and-suspenders), this means the same processing code path is safe to run an unbounded number of times on the same document.

### 3.5 Processing is idempotent by construction — enabling reprocessing later "for free"

**Decision:** The task always starts by wiping any existing chunks/vectors for that `document_id` (`_wipe_existing`) before re-extracting, regardless of whether this is the first run or a re-run.

**Why:** This was a deliberate choice so the exact same task could be reused, unmodified, for both "process a new upload" and "reprocess an existing document" (`POST /documents/{id}/reprocess`, added much later in Phase 7) — reprocessing needed no special-cased logic in the task itself, just re-enqueuing the same task after resetting status to `PENDING`. The task's idempotency was designed in from the start, even though the feature that would exploit it (manual reprocessing) didn't exist yet.

### 3.6 Failure handling: permanent vs. transient errors

**Decision:** A `PermanentProcessingError` (corrupt file, unsupported type, no extractable text) is never retried — it goes straight to `FAILED` with a message. Transient errors (`ConnectionError`, `TimeoutError`, DB/Qdrant/MinIO exceptions) are retried up to 3 times with exponential backoff (`retry_backoff=True`, capped at 60s) before falling back to `FAILED`.

**Why:** A corrupt PDF will never successfully parse no matter how many times it's retried — burning 3 retries (with backoff delays) on it just delays the user finding out it failed. Distinguishing the two error classes lets genuinely transient infrastructure hiccups (a momentary Qdrant connection blip) self-heal, while permanent failures surface immediately.

### 3.7 Background job reliability settings

**Decision:** Celery is configured with `task_acks_late=True` and `worker_prefetch_multiplier=1` — a task is only acknowledged (removed from the queue) after it completes, and a worker only prefetches one task at a time.

**Why those two settings together:** if a worker process dies mid-task, `acks_late` means Redis redelivers the task instead of losing it; `prefetch_multiplier=1` prevents one slow worker from hoarding a batch of tasks that a different, free worker could have picked up sooner. Given document processing tasks are seconds-to-minutes long and infrequent (not high-throughput), correctness-on-crash was prioritized over raw throughput. On Windows specifically, the worker runs with `--pool=solo` (documented in the README) since Celery's default prefork pool doesn't work on Windows — this is an operational necessity for local dev, not a design choice about concurrency.

---

## Phase 4 — Retrieval & RAG chat

With documents searchable in Qdrant, the next slice was letting a user actually ask questions against them.

### 4.1 Vector isolation is a Qdrant filter, not separate collections

**Decision:** A single Qdrant collection (`recall_documents`) holds every user's chunks; per-user (and per-status) isolation is enforced by filtering `query_points` on `document_id IN (<the caller's own READY document IDs>)`, computed from MySQL immediately before the query.

**Why:** Qdrant collections have fixed schema/vector-size overhead; one collection per user doesn't scale operationally (10k users → 10k collections) and isn't necessary since a `Filter(must=[FieldCondition(...)])` on payload is cheap. The document ID allowlist is always derived fresh from MySQL — never trusted from the request — so isolation can't be bypassed by a crafted document ID that belongs to another user.

### 4.2 Chat: LangGraph ReAct agent with a single tool, persisted per-turn

**Decision:** `ChatService.send_message` builds a fresh `create_react_agent` (LangGraph) per request, with exactly one tool (`search_knowledge_base`) and a system prompt instructing it to search when relevant and cite naturally otherwise. Every user and assistant message is persisted to MySQL (`Message`, with `sources` as JSON) as it happens, not just at the end of the conversation, and conversation title is derived from the first message (truncated to 60 chars) rather than a separate summarization call.

**Why one tool, not several:** the only external capability the agent currently needs is "search my documents" — adding more tools (calendar, web search, etc.) speculatively would expand the agent's failure surface for no current requirement. **Why persist per-turn instead of batching:** if the OpenAI call fails mid-conversation, the user's own message and prior turns are never lost — only the in-flight assistant response is. **Why no separate title-generation LLM call:** truncating the first user message is free and adequate; a dedicated summarization call would be a real, recurring OpenAI cost for a cosmetic label.

**Why `sources` is a JSON column on `Message`, not a separate table:** the set of sources for one message is small (at most 5, see 5.1), never queried independently of its parent message (nobody asks "show me every message that cited document X" as a feature), and read-write pattern is always "write once when the message is created, read as a whole when the message is displayed" — a normalized `message_sources` table with a foreign key would add a join for every conversation load with no query this app actually performs benefiting from it.

### 4.3 LLM provider: OpenAI `gpt-4o-mini`, single call site

**Decision:** `ChatOpenAI(model="gpt-4o-mini")` is the only LLM call in the backend, instantiated fresh per chat request rather than as a shared singleton.

**Why `gpt-4o-mini` specifically:** it's the cheapest OpenAI model capable of reliable tool-calling and RAG-style synthesis, directly following the project's cost-guardian priority over defaulting to a larger, more expensive model. This is the one deliberate exception to "prefer local/self-hosted" (embeddings and reranking both run locally) — tool-calling agent quality at this price point isn't yet matched by a model cheap enough to self-host on CPU.

---

## Phase 5 — Retrieval quality

Once basic RAG worked end-to-end, the next round of work focused specifically on answer quality: was the *right* content actually being retrieved?

### 5.1 Reranking: shared cross-encoder, raw logits (not calibrated probabilities)

**Decision:** The chat tool (and, later, the search endpoint — Phase 7) funnels its candidate pool through a cross-encoder (`cross-encoder/ms-marco-MiniLM-L-6-v2`, `app/core/reranker.py`) before final ranking: over-fetch 20 candidates from Qdrant, rerank all 20, keep the top 5 above a score threshold. The model's output is used as a **raw logit**, not a 0–1 probability — its `config.json` specifies an `Identity` activation, so no sigmoid is applied, and the threshold (`RERANK_SCORE_THRESHOLD`) is tuned against observed raw scores from real queries, not assumed probabilities.

**Why a reranker at all:** first-pass vector retrieval is a cheap, high-recall filter, but cosine similarity alone was producing results where a *topically adjacent but not actually relevant* chunk would occasionally outrank the chunk that actually answered the question. A cross-encoder that jointly attends over the (query, candidate) pair is slower but far more precise, so it's used only on the already-narrowed candidate pool (20 candidates), not the whole corpus — keeping the added latency bounded and predictable regardless of corpus size.

**Why this was verified against real observed scores rather than assuming a textbook 0.5 threshold:** since the model produces uncalibrated logits, not probabilities, a threshold of "0.5" would be meaningless — the actual threshold was set by running real queries against real documents and reading off what separated genuinely relevant hits from noise.

---

## Phase 6 — Workspaces

The first major feature added after the core RAG loop was working: personal document organization.

### 6.1 Workspaces are single-owner, not multi-user

**Decision:** Workspaces (`app/models/workspace.py`) are a personal organizational feature — folders for one user's own documents — not a sharing/collaboration primitive. There is no membership table, no roles, no invite flow. Every workspace has exactly one `user_id`.

**Why:** The PRD's FR-004–006 ("create workspaces," "delete workspaces," "workspace data shall remain isolated") is satisfiable by single-owner folders; the PRD *separately* lists "Shared Workspaces / Team Collaboration / RBAC" as an explicit Phase 2 roadmap item. Building multi-user sharing now would mean guessing at a permissions model nobody has specified yet. A `Default` workspace is auto-created per user (lazily, via `get_or_create_default`, on first need — either their first `GET /workspaces/` or their first upload with no `workspace_id` specified) so every document always has a home even for users who never explicitly create one.

**Deletion is blocked, not cascading:** deleting a non-empty workspace returns `409`; the `Default` workspace can never be deleted at all. Cascading delete would mean replicating `DocumentService.delete`'s per-document cleanup (Qdrant + MySQL + MinIO, three non-transactional systems) N times inside one request — a partial-failure surface nobody asked for. This also matches the fact that no other destructive operation in this codebase cascades.

**Chat retrieval was deliberately left workspace-unaware.** The `search_knowledge_base` tool (Phase 4) still searches across *all* of a user's `READY` documents regardless of workspace, even after workspaces were added. Scoping it to one workspace would silently hide relevant content filed in a different folder, which is a worse user experience than occasionally over-fetching — and workspaces aren't a security boundary (RBAC is explicitly out of scope), so there's no isolation reason to scope it either. This was a conscious decision to *not* touch an already-working, already-tuned system just because a newer organizational concept became available.

---

## Phase 7 — Final feature-completion pass: profile management, reprocessing, citation excerpts, hybrid search

The last phase of backend work closed out the remaining PRD functional requirements.

### 7.1 Profile management lives in `AuthService`, not a new `UserService`

**Decision:** `PATCH /auth/me` and its logic (`AuthService.update_profile`) were added to the existing `AuthService`/`auth.py` router rather than creating a new `UserService`/`users.py`.

**Why:** Editing your own name or password is squarely an "account" concern, and `AuthService` already owned every other account operation (register, login, OAuth). A new service for one endpoint would split account logic across two files for no organizational benefit — this follows the same "don't add a layer until a second real use case justifies it" principle as the repository-layer decision (0.3).

**Password change requires the current password, except for OAuth-only accounts.** If `user.password` is already set, changing it requires a matching `current_password` (bcrypt-verified) or the request is rejected with `401`. If the account has no password yet (a Google-only signup), a new password can be set without one, since there's nothing to verify against. This is defense-in-depth against a stolen/leaked access token being used to silently take over an account by changing its password — the attacker would still need the current password.

### 7.2 Reprocessing has a concurrency guard, not a lock

**Decision:** `POST /documents/{id}/reprocess` checks the document's current status and returns `409` if it's already `PENDING` or `PROCESSING`, rather than acquiring a DB row lock, before resetting status to `PENDING` and re-enqueuing the same idempotent task from Phase 3.5.

**Why no lock:** a real lock (`SELECT ... FOR UPDATE`) would need to be held across the check *and* the Celery enqueue, which spans a network hop — not something you want inside a DB transaction. The check-then-set pattern has a theoretical TOCTOU race under concurrent double-clicks, but the impact of losing that race is just a duplicate (harmless, idempotent — see 3.5) processing run, not data corruption. This mirrors the same accepted-risk, unlocked check-then-act pattern already used for auto-creating a user's Default workspace (6.1).

### 7.3 Citations carry a real excerpt, not just a filename

**Decision:** Both chat sources and search results (7.5) return a truncated excerpt (300 chars) of the actual chunk text alongside the filename/page number, computed once at query time from the already-retrieved chunk text and never stored as a separate column.

**Why:** A citation that only names a file forces the user to open the document to check whether the AI actually found the right passage. Reusing the JSON `sources` column that already existed for chat (see 4.2) kept this a pure application-layer addition — no migration needed, just one more key in a dict that was already being built.

### 7.4 Retrieval, part two: two deliberately different paths

By this phase, two independent retrieval mechanisms existed in the backend, on purpose:

**a. Chat's `search_knowledge_base` tool (Phase 4/5) — semantic only, unfiltered.** Kept exactly as built: pure vector search, cross-encoder reranked, no lexical component, no metadata filters, not workspace-scoped (6.1).

**b. The new standalone `/search` endpoint — hybrid (semantic + lexical), filterable.** A separate `SearchService` (`app/services/searchService.py`) powers `POST /api/v1/search/` with genuinely different behavior:
- **Semantic leg** — the same Qdrant vector search pattern as chat's tool.
- **Lexical leg** — a MySQL `FULLTEXT` index added on `document_chunks.content` (a new migration, index-only, no data backfill needed), queried with `MATCH(content) AGAINST(:query IN NATURAL LANGUAGE MODE)`.
- **Fusion** — Reciprocal Rank Fusion (`1 / (60 + rank + 1)`, summed across both ranked lists) merges the two candidate sets before reranking, rather than picking one or the other or a hand-tuned linear blend.
- **Metadata filters** — `workspace_id`, `mime_type`, and a `date_from`/`date_to` range are applied once, up front, to the same `Document` query that produces the allowed-ID set for *both* the semantic and lexical legs — so a filter can never apply to one retrieval path but not the other.

**Why RRF specifically:** it needs no score calibration between two completely different scoring systems (cosine similarity vs. MySQL's internal relevance score) — it only cares about rank position in each list, which is directly comparable. A weighted-score blend would require guessing a scale factor between two incomparable units.

**Why FULLTEXT in MySQL rather than a dedicated search engine (Elasticsearch/OpenSearch/Meilisearch):** the corpus size in scope doesn't justify running and operating a fourth database. MySQL's native FULLTEXT index is free, already colocated with the chunk text it indexes, and sufficient for the lexical half of a small-to-medium personal knowledge base. This can be revisited if corpus size or query volume ever demands it.

**Why this is a separate endpoint instead of adding lexical/filters to the chat tool:** the chat tool was already built, tuned, and verified (Phases 4–5); folding new retrieval logic into it would risk regressing agent behavior that already worked, for a capability (exact keyword match, explicit filters) that's a genuinely different user intent — "search my documents" (AI Search page) versus "have a conversation grounded in my documents" (Chat page).

### 7.5 `SearchResult` includes `mime_type`, added after the initial cut

**Decision:** The search endpoint's response includes each result's `mime_type` (pulled from the same `Document` lookup already used for `original_filename`), even though it wasn't in the first version of the endpoint.

**Why:** The frontend's AI Search results list wanted to show the same file-type icon used everywhere else in the app (Vault, Dashboard) via the shared `fileIcon(mimeType)` helper — this was a one-line backend addition once that frontend need became concrete, rather than something anticipated up front.

---

---

## Phase 8 — Operability: health checks, quotas, activity history, retrieval performance

A later pass focused on making the system observable, bounded, and measurably faster, rather than adding user-facing features.

### 8.1 Migration history squashed from seven files to one

**Decision:** The seven incremental migrations were collapsed into a single `create initial schema` migration, before any database had ever applied them.

**Why it was safe:** squashing rewrites history, which breaks any database whose `alembic_version` row references a revision that no longer exists. It was verified first that no environment — local, shared, or otherwise — had ever run them. On a from-scratch schema the old workspace backfill (`INSERT` a Default workspace, `UPDATE documents.workspace_id`) is dead weight: there is no pre-existing data to backfill, so `workspace_id` is simply `NOT NULL` from the start. The hand-written backfill pattern from 0.4/2.4 still applies to any *future* migration against populated tables.

### 8.2 Health checks: split liveness from readiness

**Decision:** Two unauthenticated endpoints outside `/api/v1`. `GET /health` always returns 200 without touching anything. `GET /health/ready` probes MySQL, Redis, Qdrant and MinIO concurrently and returns 200 `ready` or 503 `degraded` with per-dependency status.

**Why split them:** they answer different questions. Liveness means "is this process able to serve at all" and is what an orchestrator restarts on — making it depend on Redis would get a perfectly healthy container killed during a Redis blip. Readiness means "can this instance actually complete a request" and is what a load balancer should route on. Collapsing them into one endpoint forces one of those two behaviours to be wrong.

**Why unauthenticated, and why error *types* rather than messages:** an orchestrator has no bearer token, so the endpoint has to be open. That makes the response body public, and driver errors routinely embed the DSN — so a failed probe reports `type(exc).__name__` (`OperationalError`) and never the exception message.

**Why each probe has its own client with its own socket timeout:** the first implementation wrapped the shared clients in `asyncio.wait_for`. That was wrong. `wait_for` cancels the *await*, but cannot kill a thread already blocked in a socket read — so a down dependency leaked a thread per poll and the endpoint took ~30s despite a 3s timeout, under exactly the failure it exists to detect. The fix is client-level: dedicated probe clients with explicit connect/read timeouts, so the blocking call itself gives up. The `asyncio` timeout remains only as a backstop, and is deliberately set *looser* than the client timeouts — otherwise it fires first and masks the real error type behind a generic `timeout`.

### 8.3 Storage quota enforced on upload, not merely displayed

**Decision:** `STORAGE_QUOTA_BYTES` (configurable, 10GB default) is enforced inside `upload_to_minio`, and exposed via `GET /documents/usage`.

**Why 507 rather than 413:** the per-file 50MB cap already returns `413 Request Entity Too Large`. "This file is too big" and "your account is full" are different problems with different user remedies, so conflating them into one status hides which is which. `507 Insufficient Storage` says exactly the latter.

**Why the check sits where it does:** after the file has been read (the size is not reliably known before that) but *before* any `put_object` call — so a rejected upload never occupies storage that the quota is supposed to be protecting. The frontend previously displayed a hardcoded "8.5 GB / 10 GB"; the figure is now real and actually applied.

### 8.4 Activity history is captured, not synthesised

**Decision:** An `activity_events` table records real lifecycle moments — document uploaded, processed, failed; conversation started — with access frequency tracked separately in Redis using ISO-week-bucketed sorted sets.

**Why capture instead of LLM synthesis:** the original design called for "memory nodes" synthesised by clustering conversations. That would mean a recurring LLM cost per synthesis for what is essentially an activity feed, against a project whose first technical principle is cost. Capture produces something truthful for zero marginal cost. The consequence is accepted honestly: features that genuinely need synthesis — topic categories, auto-tags, relevance scores — were dropped rather than faked.

**Why the event title is denormalised and the foreign keys are `ON DELETE SET NULL`:** a history that erases itself when you delete the thing it describes is not a history. The row keeps its text and survives; only the link goes.

**Why recording can never raise:** `MemoryService.record` swallows and logs every exception. Activity logging is strictly secondary to the operation it describes — a failed timeline write must not be able to fail a document upload or lose a chat turn.

### 8.5 Retrieval performance: measured, and mostly *not* changed

**Decision:** The reranker now runs as an int8-quantised ONNX build of the same model. The embedding model, candidate pool size, and score threshold were all left alone.

**Why, with numbers.** Measured on an 8-core CPU: query embedding is **~22 ms**; reranking 20 candidates is **~1100-1600 ms**. Reranking is effectively the entire retrieval cost. That reframed every candidate change:

| Change considered | Measured | Outcome |
|---|---|---|
| Swap to a larger embedding model | embedder is 22ms of the budget | **Rejected** — optimises the cheapest stage, and would cost ~2.5GB RAM loaded twice (API process embeds queries, Celery worker embeds documents) |
| Raise candidate pool 20 to 50 | **7910 ms** | **Rejected** — unusable |
| Swap to `bge-reranker-base` (the TRD's original pick) | ~12x the parameters | **Rejected** — many seconds on CPU, no GPU available |
| Cap cross-encoder `max_length` at 128 | 1570 to 384 ms | **Rejected** — see below |
| int8 ONNX quantisation | 1145 to 745 ms, ~1.5x | **Adopted** |

**Why truncation was rejected despite being the biggest speedup:** it silently breaks correctness. With `max_length=128`, a chunk whose answer sits mid-passage scored **-11.05 — identical to pure filler**. The relevant document is discarded with no signal that it happened. A 4x speedup that occasionally drops the right answer is not a speedup.

**Why the threshold was left at `0.0` despite being an untuned guess:** measurement showed it is already in a wide safe band. Clear-cut relevant passages score ~+7.7 against ~-11.3 for irrelevant ones, but passages where the answer is *buried* score only **+0.31 to +1.25** — so raising the threshold would start discarding correct results. The comment calling it a guess is accurate; the value happens to be right.

**Why int8 was verified rather than assumed:** quantisation is lossy, and the failure mode would resemble truncation's. It was compared against fp32 on identical inputs: maximum drift **0.49 logits**, and nothing fp32 kept fell below the threshold. Adopted only after that check.

### 8.6 Models are loaded at startup, not on first request

**Decision:** The FastAPI lifespan hook loads the embedding and reranker models alongside the existing MinIO/Qdrant client warmup.

**Why:** lazily loading them meant one unlucky user's first query paid a ~12s model load. Uvicorn withholds traffic until lifespan completes, so moving it there trades ~11s of boot time — including on every `--reload` in development — for never charging that cost to a request. It also makes `/health/ready` honest, since the process cannot report ready before the models exist. The Celery worker is deliberately *not* warmed: uploads return `202` immediately, so nobody waits synchronously on it.

### 8.7 Tests cover logic, not integration

**Decision:** `backend/tests/` runs against in-memory SQLite with MinIO, Qdrant, Redis and Celery patched out. Coverage is narrow by design: storage-quota enforcement, per-user isolation on the memory endpoints, health-probe behaviour, and upload validation.

**Why this scope:** these are the paths where a silent regression is most costly — a broken ownership filter leaks another user's data, and a broken quota check is invisible until storage fills. They also run in ~2s with no infrastructure, so they stay usable. Integration with the real services is explicitly *not* covered and still needs manual verification against a running stack.

---

## Deviations from the original architecture plan

`docs/ARCHITECTURE.md` was written before implementation and describes a fuller structure (`app/repositories/`, `app/agents/`, `app/workers/`, `app/middleware/`) that was never built. What was actually built is intentionally leaner:

| Planned | Built instead | Why |
|---|---|---|
| `app/repositories/` | Services query models directly | No query complex enough to justify the indirection yet (0.3) |
| `app/agents/` (MemoryAgent, PlanningAgent, etc.) | One LangGraph ReAct agent, one tool | Only one agentic capability exists today (RAG search); a multi-agent framework would be scaffolding for features that don't exist (4.2) |
| `app/workers/` | `app/tasks/document_processor.py` (Celery) | Same concept, different name — one task module was enough for the one background job that exists (3.1) |
| `app/middleware/` | None — auth/rate-limiting handled per-route via `Depends` | FastAPI's dependency system covers this without a separate middleware layer for the routes that exist |

This is a deliberate outcome of the project's anti-overengineering stance: build the structure the current features need, and let new layers earn their place when a real second use case shows up — not before.
