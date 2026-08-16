from datetime import date

from pydantic import BaseModel, field_validator


class SearchRequest(BaseModel):
    query: str
    workspace_id: int | None = None
    mime_type: str | None = None
    date_from: date | None = None
    date_to: date | None = None

    @field_validator("query")
    @classmethod
    def query_must_not_be_blank(cls, v):
        if not v.strip():
            raise ValueError("Search query is required")
        return v.strip()
