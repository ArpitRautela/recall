from pydantic import BaseModel, field_validator


class ProfileUpdateRequest(BaseModel):
    full_name: str | None = None
    current_password: str | None = None
    new_password: str | None = None

    @field_validator("full_name")
    @classmethod
    def full_name_must_not_be_blank(cls, v):
        if v is not None and not v.strip():
            raise ValueError("Full name cannot be blank")
        return v.strip() if v is not None else v

    @field_validator("new_password")
    @classmethod
    def new_password_min_length(cls, v):
        if v is not None and len(v) < 6:
            raise ValueError("New password must be at least 6 characters")
        return v
