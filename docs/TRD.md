# RECALL

## Technical Requirements Document (TRD)

> Cost-Optimized Technical Blueprint for the RECALL Document Intelligence Platform

---

# Document Information

| Field        | Value                           |
| ------------ | ------------------------------- |
| Product      | RECALL                          |
| Version      | 1.0                             |
| Author       | Arpit Rautela                   |
| Status       | Draft                           |
| Type         | Technical Requirements Document |
| Last Updated | June 2026                       |

---

# 1. Purpose

This document defines the technical architecture, infrastructure requirements, storage strategy, service design, scalability approach, and implementation constraints for RECALL.

The primary goal is to build a highly capable Retrieval-Augmented Generation (RAG) platform while maintaining extremely low operational costs during development and early-stage deployment.

---

# 2. Engineering Principles

## Principle 1: Cost First

Every technical decision must prioritize:

* Free local development
* Low cloud expenditure
* Minimal third-party dependencies
* Open-source alternatives where possible

---

## Principle 2: Modular Architecture

The system shall be designed as a modular monolith.

Benefits:

* Easier development
* Easier debugging
* Lower infrastructure costs
* Faster iteration

Modules must be separable into microservices in the future.

---

## Principle 3: Vendor Independence

The platform shall avoid tight coupling with:

* LLM providers
* Cloud providers
* Vector databases

All major components should be replaceable.

---

## Principle 4: Evidence-Based AI

Every generated answer must be grounded in retrieved document context.

No answer should rely solely on model knowledge.

---

# 3. System Objectives

The platform shall:

* Ingest documents asynchronously
* Support semantic search
* Support keyword search
* Provide hybrid retrieval
* Generate citation-backed responses
* Maintain workspace isolation
* Scale to thousands of users
* Remain deployable on a single low-cost VPS

---

# 4. High-Level Architecture

```text
                    Web Client
                         |
                    FastAPI API
                         |
      ---------------------------------------
      |             |                      |
 Authentication  Document Service   Chat Service
      |             |                      |
      ---------------------------------------
                         |
                    PostgreSQL
                         |
               pgvector Extension
                         |
                      Redis
                         |
                      Celery
                         |
                Processing Workers
                         |
        --------------------------------
        |              |               |
   Extraction      Chunking      Embeddings
                         |
                      MinIO
                         |
                  LLM Provider
```

---

# 5. Technology Stack

## Backend

| Component      | Technology   |
| -------------- | ------------ |
| Language       | Python 3.13+ |
| API Framework  | FastAPI      |
| Validation     | Pydantic     |
| ORM            | SQLAlchemy   |
| Migrations     | Alembic      |
| Authentication | JWT          |

---

## Data Layer

| Component        | Technology |
| ---------------- | ---------- |
| Primary Database | PostgreSQL |
| Vector Storage   | pgvector   |
| Cache            | Redis      |

---

## File Storage

| Component         | Technology            |
| ----------------- | --------------------- |
| Local Development | MinIO                 |
| Future Production | S3 Compatible Storage |

---

## Processing

| Component  | Technology     |
| ---------- | -------------- |
| Task Queue | Celery         |
| Broker     | Redis          |
| Workers    | Celery Workers |

---

## AI Components

| Component  | Initial Choice                  |
| ---------- | ------------------------------- |
| Embeddings | BGE Small                       |
| Reranker   | BGE Reranker Base               |
| Chunking   | Recursive Chunking              |
| LLM        | User-Provided API Key or Gemini |

---

# 6. Cost Optimization Strategy

## Development Cost

Target:

```text
₹0/month
```

All services run locally through Docker.

---

## MVP Production Cost

Target:

```text
₹500 - ₹1000/month
```

Single VPS deployment.

---

## Costly Technologies Deferred

The following technologies are intentionally excluded from V1:

* Kubernetes
* Kafka
* Qdrant
* Elasticsearch
* Dedicated API Gateway
* Service Mesh
* Distributed Tracing Infrastructure
* Multi-Region Deployments

---

# 7. Core Modules

## Authentication Module

Responsibilities:

* Registration
* Login
* JWT Management
* Password Reset

---

## Workspace Module

Responsibilities:

* Workspace CRUD
* Workspace Isolation
* Ownership Validation

---

## Document Module

Responsibilities:

* Upload
* Metadata Storage
* Deletion
* Reprocessing

Supported Formats:

* PDF
* DOCX

---

## Processing Module

Responsibilities:

* Text Extraction
* Metadata Extraction
* Chunk Creation
* Embedding Generation

All operations shall be asynchronous.

---

## Retrieval Module

Responsibilities:

* Vector Search
* Keyword Search
* Hybrid Search
* Metadata Filtering
* Result Fusion

---

## Chat Module

Responsibilities:

* Conversation Storage
* Context Assembly
* Prompt Generation
* Response Generation

---

# 8. Database Requirements

## PostgreSQL

Stores:

* Users
* Workspaces
* Documents
* Conversations
* Messages
* Metadata

Extensions:

```sql
pgvector
uuid-ossp
```

---

# 9. Vector Storage Requirements

Instead of a dedicated vector database, vectors shall initially be stored in PostgreSQL using pgvector.

Reasons:

* Lower cost
* Simpler deployment
* Fewer services
* Easier maintenance

Expected Capacity:

```text
5M+ vectors
```

Migration to Qdrant only when operational requirements justify separation.

---

# 10. Redis Requirements

Redis shall support:

* Celery Queue
* Rate Limiting
* Query Cache
* Session Cache

Cache TTL:

```text
15 Minutes
```

---

# 11. Object Storage Requirements

Document binaries shall be stored in MinIO.

Metadata shall remain in PostgreSQL.

Maximum File Size:

```text
200 MB
```

Future:

```text
1 GB
```

---

# 12. Document Processing Pipeline

```text
Upload
   ↓
Validation
   ↓
MinIO Storage
   ↓
Processing Queue
   ↓
Text Extraction
   ↓
Cleaning
   ↓
Chunking
   ↓
Embedding Generation
   ↓
pgvector Storage
   ↓
Ready
```

---

# 13. Chunking Strategy

Initial Configuration:

```text
Chunk Size: 800 Tokens
Overlap: 120 Tokens
```

Stored Metadata:

* Workspace ID
* Document ID
* Page Number
* Chunk Index

Future Support:

* Semantic Chunking
* Hierarchical Chunking
* Parent Child Chunking

---

# 14. Retrieval Pipeline

```text
User Query
      ↓
Query Cleaning
      ↓
Vector Search
      ↓
Keyword Search
      ↓
Reciprocal Rank Fusion
      ↓
Reranking
      ↓
Top Context Chunks
      ↓
Prompt Assembly
      ↓
LLM
      ↓
Citation Mapping
      ↓
Response
```

---

# 15. Citation Requirements

Each answer must contain:

* Source Document
* Page Number
* Supporting Excerpt

The system must be able to trace every generated statement back to retrieved chunks.

---

# 16. API Requirements

Authentication Required:

```text
/api/v1/*
```

Core Endpoints:

```http
POST   /auth/register
POST   /auth/login

POST   /workspaces
GET    /workspaces

POST   /documents/upload
GET    /documents
DELETE /documents/{id}

POST   /chat/query

GET    /conversations
POST   /conversations
```

---

# 17. Security Requirements

Authentication:

* JWT Access Tokens
* Refresh Tokens

Authorization:

* Workspace-Level Validation
* Resource Ownership Validation

Encryption:

* TLS 1.3
* Encrypted Secrets Storage

Password Hashing:

```text
bcrypt
```

---

# 18. Performance Targets

| Metric                 | Target   |
| ---------------------- | -------- |
| Upload Acknowledgement | < 2 sec  |
| Retrieval              | < 500 ms |
| Chat Response          | < 5 sec  |
| Concurrent Users       | 1000+    |

---

# 19. Reliability Requirements

The system shall:

* Retry failed embedding jobs
* Retry failed extraction jobs
* Recover worker crashes
* Preserve uploaded files
* Prevent vector inconsistency

---

# 20. Observability

Initial Metrics:

* Request Count
* Error Rate
* Average Latency
* Queue Depth
* Processing Throughput

Logging:

* Structured JSON Logs

Future:

* Prometheus
* Grafana
* OpenTelemetry

---

# 21. Deployment Strategy

## Local Development

```text
Docker Compose

- FastAPI
- PostgreSQL
- Redis
- MinIO
- Celery Worker
```

Cost:

```text
₹0
```

---

## MVP Production

```text
Single VPS

8 GB RAM
4 vCPU
100 GB SSD
```

Expected Cost:

```text
₹500–1000/month
```

---

# 22. Technical Acceptance Criteria

The platform shall:

✓ Upload documents

✓ Process documents asynchronously

✓ Generate embeddings

✓ Store vectors

✓ Retrieve relevant context

✓ Generate citation-backed answers

✓ Support multiple workspaces

✓ Recover from worker failures

✓ Deploy through Docker Compose

✓ Operate on a single VPS

---

# 23. Future Improvement Roadmap

## Phase 2 – Retrieval Enhancements

Objectives:

* Improve answer quality
* Improve retrieval precision

Features:

* Hybrid Search Optimization
* Advanced Metadata Filters
* Query Rewriting
* Multi-Query Retrieval
* Semantic Chunking

---

## Phase 3 – Collaboration

Objectives:

* Multi-user knowledge management

Features:

* Shared Workspaces
* Workspace Invitations
* Role-Based Access Control
* Team Knowledge Bases

---

## Phase 4 – Scale Architecture

Objectives:

* Support millions of vectors

Changes:

* Migrate pgvector → Qdrant
* Read Replicas
* Distributed Workers
* Dedicated Retrieval Service

---

## Phase 5 – Advanced RAG

Objectives:

* Improve reasoning across documents

Features:

* Cross-Document Reasoning
* Multi-Hop Retrieval
* Parent-Child Retrieval
* Agentic Retrieval Pipelines

---

## Phase 6 – Knowledge Intelligence

Objectives:

* Move beyond document search

Features:

* Knowledge Graph Generation
* Relationship Discovery
* Entity Linking
* Research Workflows

---

## Phase 7 – Enterprise Readiness

Features:

* SSO
* Audit Dashboard
* Compliance Controls
* Data Retention Policies
* Enterprise Integrations

---

## Phase 8 – Multimodal Intelligence

Features:

* OCR
* Image Understanding
* Diagram Understanding
* Presentation Processing
* Video Knowledge Extraction

---

# 24. Long-Term Vision

RECALL evolves from a document chat application into a comprehensive knowledge operating system capable of:

* Understanding large information repositories
* Connecting knowledge across documents
* Providing traceable answers
* Supporting research workflows
* Acting as an organizational memory layer

while maintaining transparency, scalability, and cost efficiency.
