from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.document import Document
from app.models.workspace import Workspace


class WorkspaceService:

    def create(db: Session, user_id: int, name: str) -> Workspace:
        ws = Workspace(user_id=user_id, name=name, is_default=False)
        db.add(ws)
        db.commit()
        db.refresh(ws)
        return ws

    def get_by_id(db: Session, workspace_id: int, user_id: int) -> Workspace:
        ws = (
            db.query(Workspace)
            .filter(Workspace.id == workspace_id, Workspace.user_id == user_id)
            .first()
        )
        if ws is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
        return ws

    def get_or_create_default(db: Session, user_id: int) -> Workspace:
        ws = (
            db.query(Workspace)
            .filter(Workspace.user_id == user_id, Workspace.is_default.is_(True))
            .first()
        )
        if ws is not None:
            return ws
        ws = Workspace(user_id=user_id, name="Default", is_default=True)
        db.add(ws)
        db.commit()
        db.refresh(ws)
        return ws

    def list_for_user(db: Session, user_id: int) -> list[dict]:
        WorkspaceService.get_or_create_default(db, user_id)

        counts = dict(
            db.query(Document.workspace_id, func.count(Document.id))
            .filter(Document.user_id == user_id)
            .group_by(Document.workspace_id)
            .all()
        )
        workspaces = (
            db.query(Workspace)
            .filter(Workspace.user_id == user_id)
            .order_by(Workspace.is_default.desc(), Workspace.created_at)
            .all()
        )
        return [
            {
                "id": w.id,
                "name": w.name,
                "is_default": w.is_default,
                "document_count": counts.get(w.id, 0),
                "created_at": w.created_at,
                "updated_at": w.updated_at,
            }
            for w in workspaces
        ]

    def delete(db: Session, workspace_id: int, user_id: int) -> None:
        ws = WorkspaceService.get_by_id(db, workspace_id, user_id)
        if ws.is_default:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="The Default workspace cannot be deleted"
            )
        doc_count = db.query(func.count(Document.id)).filter(Document.workspace_id == ws.id).scalar()
        if doc_count > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Workspace is not empty. Delete or move its documents first.",
            )
        db.delete(ws)
        db.commit()
