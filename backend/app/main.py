from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.auth import router as authRoutes
from app.api.v1.chat import router as chatRoutes
from app.api.v1.documents import router as documentsRoutes
from app.api.v1.health import router as healthRoutes
from app.api.v1.memory import router as memoryRoutes
from app.api.v1.search import router as searchRoutes
from app.api.v1.workspaces import router as workspacesRoutes
from app.core.config import settings
from app.core.embeddings import get_embedding_model
from app.core.minio_client import get_minio_client
from app.core.qdrant_client import get_qdrant_client
from app.core.reranker import get_reranker_model


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_minio_client()
    get_qdrant_client()
    # Load the retrieval models here rather than lazily on first use: together they take
    # ~15s, and uvicorn withholds traffic until startup completes, so this costs boot time
    # instead of making one unlucky user's first query wait for it.
    get_embedding_model()
    get_reranker_model()
    yield


app = FastAPI(title="Recall API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(authRoutes, prefix="/api/v1/auth")
app.include_router(documentsRoutes, prefix="/api/v1/documents")
app.include_router(chatRoutes, prefix="/api/v1/chat")
app.include_router(workspacesRoutes, prefix="/api/v1/workspaces")
app.include_router(searchRoutes, prefix="/api/v1/search")
app.include_router(memoryRoutes, prefix="/api/v1/memory")
app.include_router(healthRoutes)
