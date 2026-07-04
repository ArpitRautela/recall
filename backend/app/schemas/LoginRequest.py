from pydantic import BaseModel, field_validator


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def email_must_not_be_empty(cls, v):
        if not v.strip():
            raise ValueError("Email is required")
        return v.strip()

    @field_validator("password")
    @classmethod
    def password_must_not_be_empty(cls, v):
        if not v.strip():
            raise ValueError("Password is required")
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v