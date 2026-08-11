from pydantic import BaseModel, field_validator


class WorkspaceRequest(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_must_be_valid(cls, v):
        if not v.strip():
            raise ValueError("Workspace name is required")
        if len(v) > 255:
            raise ValueError("Workspace name must be 255 characters or fewer")
        return v.strip()
