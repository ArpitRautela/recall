from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.user_dtl import User
from app.schemas.SearchRequest import SearchRequest
from app.services.searchService import SearchService

router = APIRouter()


@router.post("/")
async def search(
    body: SearchRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    results = SearchService.search(
        db,
        user.id,
        body.query,
        workspace_id=body.workspace_id,
        mime_type=body.mime_type,
        date_from=body.date_from,
        date_to=body.date_to,
    )
    return {"query": body.query, "results": results}
