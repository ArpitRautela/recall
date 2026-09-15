from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.user_dtl import User
from app.services.memoryService import MemoryService

router = APIRouter()


@router.get("/timeline")
async def timeline(
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return MemoryService.timeline(db, user.id, limit)


@router.get("/frequent")
async def frequent(
    limit: int = Query(5, ge=1, le=50),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return MemoryService.frequent(db, user.id, limit)


@router.get("/recent")
async def recent(
    limit: int = Query(8, ge=1, le=50),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return MemoryService.recent(db, user.id, limit)
