from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.user_dtl import User
from app.schemas.WorkspaceRequest import WorkspaceRequest
from app.services.workspaceService import WorkspaceService

router = APIRouter()


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_workspace(
    body: WorkspaceRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ws = WorkspaceService.create(db, user.id, body.name)
    return {
        "id": ws.id,
        "name": ws.name,
        "is_default": ws.is_default,
        "document_count": 0,
        "created_at": ws.created_at,
        "updated_at": ws.updated_at,
    }


@router.get("/")
async def list_workspaces(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return WorkspaceService.list_for_user(db, user.id)


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    WorkspaceService.delete(db, workspace_id, user.id)
