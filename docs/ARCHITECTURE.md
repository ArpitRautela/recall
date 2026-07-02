# RECALL Repository Architecture

# Purpose

RECALL is designed as an AI-first conversational platform with persistent memory, semantic retrieval, agent orchestration, and workspace support.

The repository follows a modular monolith architecture to optimize for:

* Rapid development
* Low infrastructure cost
* Simple deployment
* Clear separation of concerns
* Future migration to microservices if required

---

# Repository Structure

```text
recall/
│
├── frontend/
├── backend/
├── docs/
├── infrastructure/
├── scripts/
│
├── docker-compose.yml
├── .env
├── .gitignore
└── README.md
```

---

# Root Directory

## docker-compose.yml

The orchestration layer for local development.

Responsibilities:

* Starts all required containers
* Creates the internal Docker network
* Connects frontend and backend
* Connects backend with databases
* Manages persistent volumes

Services managed:

* frontend
* backend
* mysql
* redis
* qdrant

Example startup:

```bash
docker compose up --build
```

---

## .env

Centralized environment configuration.

Typical contents:

```env
DATABASE_URL=
REDIS_URL=
QDRANT_URL=
OPENAI_API_KEY=
JWT_SECRET=
```

This file should never be committed to Git.

---

## README.md

Entry point for developers.

Should contain:

* project overview
* setup instructions
* architecture overview
* local development guide

---

# Frontend

Location:

```text
frontend/
```

Technology stack:

* Next.js
* React
* TypeScript
* Tailwind
* Shadcn UI
* Zustand

Purpose:

Responsible for user interaction and presentation logic.

---

## frontend/src/app

Application routes.

Examples:

```text
chat/
login/
register/
settings/
```

Responsibilities:

* page rendering
* route layouts
* route protection

Equivalent to:

* pages in traditional MVC systems

---

## frontend/src/components

Reusable UI components.

Examples:

```text
chat/
sidebar/
ui/
shared/
settings/
```

Responsibilities:

* rendering
* visual composition
* reusable widgets

No API calls should be made directly inside components.

---

## frontend/src/services

Frontend API clients.

Examples:

```text
auth.ts
chat.ts
memory.ts
workspace.ts
```

Responsibilities:

* HTTP communication
* request serialization
* response handling

Equivalent to:

* API SDK layer

---

## frontend/src/store

Global application state.

Examples:

```text
authStore.ts
chatStore.ts
memoryStore.ts
```

Responsibilities:

* user state
* active conversation
* cached responses
* session information

---

## frontend/src/providers

Application providers.

Examples:

```text
ThemeProvider
AuthProvider
QueryProvider
```

Responsibilities:

* application context
* theme management
* authentication context

---

## frontend/src/hooks

Reusable React hooks.

Examples:

```text
useAuth()
useStreamingChat()
useConversation()
```

---

## frontend/src/types

Shared TypeScript models.

Examples:

```text
User
Conversation
Message
Workspace
```

---

## frontend/src/constants

Application constants.

Examples:

```text
API paths
theme definitions
limits
feature flags
```

---

## frontend/src/lib

Generic utilities.

Examples:

```text
date formatting
helpers
string utilities
```

---

# Backend

Location:

```text
backend/
```

Technology stack:

* FastAPI
* SQLAlchemy
* Alembic
* MySQL
* Redis
* Qdrant

Purpose:

Contains all business logic.

---

## backend/app/api

HTTP layer.

Responsibilities:

* request handling
* validation
* response formatting

Equivalent to:

```text
Spring Controllers
```

Example:

```text
POST /chat
GET /memory
POST /auth/login
```

---

## backend/app/services

Business logic layer.

Responsibilities:

* orchestrating workflows
* applying business rules
* coordinating repositories

Equivalent to:

```text
Spring Services
```

---

## backend/app/repositories

Database access layer.

Responsibilities:

* SQL operations
* persistence
* query abstraction

Equivalent to:

```text
Spring Data Repositories
```

---

## backend/app/models

Database entities.

Examples:

```text
User
Conversation
Message
Memory
Workspace
```

---

## backend/app/schemas

Request and response contracts.

Examples:

```text
ChatRequest
ChatResponse
LoginRequest
```

Equivalent to:

```text
DTO objects
```

---

## backend/app/core

Application configuration.

Contains:

```text
config.py
database.py
security.py
```

Responsibilities:

* database initialization
* security configuration
* environment loading

---

## backend/app/middleware

Cross-cutting concerns.

Examples:

* logging
* request tracing
* authentication
* rate limiting

---

## backend/app/workers

Background jobs.

Examples:

* title generation
* embedding creation
* memory summarization

These should not block request processing.

---

## backend/app/agents

AI orchestration layer.

Examples:

```text
MemoryAgent
PlanningAgent
RetrievalAgent
ReasoningAgent
```

This is the core differentiator of RECALL.

---

## backend/tests

Automated tests.

Types:

* unit tests
* integration tests
* API tests

---

## backend/alembic

Database migration system.

Responsibilities:

* schema versioning
* migration tracking
* rollback support

Equivalent to:

```text
Flyway
Liquibase
```

---

# Docs

Location:

```text
docs/
```

Purpose:

Project knowledge repository.

Contents:

```text
PRD.md
TRD.md
HLD.md
ARCHITECTURE.md
```

---

## PRD.md

Product Requirements Document.

Defines:

* business goals
* target users
* features

---

## TRD.md

Technical Requirements Document.

Defines:

* technical decisions
* constraints
* non-functional requirements

---

## HLD.md

High Level Design.

Defines:

* components
* interactions
* system boundaries

---

# Infrastructure

Location:

```text
infrastructure/
```

Optional during early development.

Future responsibilities:

* reverse proxy configuration
* monitoring
* observability
* deployment manifests

Examples:

```text
nginx/
prometheus/
grafana/
```

---

# Scripts

Location:

```text
scripts/
```

Utility automation.

Examples:

```text
seed_data.py
create_admin.py
backup.sh
reset_db.sh
```

---

# Database Responsibilities

## MySQL

Stores:

* users
* conversations
* messages
* workspaces
* preferences

---

## Redis

Stores:

* cache
* session data
* rate limits
* background queues

---

## Qdrant

Stores:

* embeddings
* semantic memory
* retrieval vectors

---

# Development Workflow

## Start environment

```bash
docker compose up --build
```

## Stop environment

```bash
docker compose down
```

## Remove volumes

```bash
docker compose down -v
```

---

# Architectural Principle

RECALL intentionally starts as a:

```text
Modular Monolith
```

Advantages:

* easier debugging
* simpler deployment
* lower operational cost
* faster development

Migration to microservices should happen only when operational requirements justify the additional complexity.
