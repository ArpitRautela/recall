import secrets

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.redis_client import redis_client
from app.schemas.LoginRequest import LoginRequest
from app.schemas.ProfileUpdateRequest import ProfileUpdateRequest
from app.schemas.RegisterRequest import RegisterRequest
from app.services.authService import AuthService

router = APIRouter()
bearer = HTTPBearer()

GOOGLE_REDIRECT_URI = "http://localhost:8000/api/v1/auth/google/callback"


# ── DB dependency ─────────────────────────────────────────────────────────────

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Request bodies ────────────────────────────────────────────────────────────

class RefreshRequest(BaseModel):
    refresh_token: str


class ExchangeRequest(BaseModel):
    code: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/login")
async def login(request: LoginRequest, req: Request, db: Session = Depends(get_db)):
    ip = req.client.host if req.client else "unknown"
    return AuthService.login(request, db, ip)


@router.post("/register")
async def register(request: RegisterRequest, db: Session = Depends(get_db)):
    return AuthService.register(request, db)


@router.post("/refresh")
async def refresh(body: RefreshRequest, db: Session = Depends(get_db)):
    return AuthService.refresh_tokens(body.refresh_token, db)


@router.post("/exchange")
async def exchange(body: ExchangeRequest, db: Session = Depends(get_db)):
    return AuthService.exchange_oauth_code(body.code, db)


@router.get("/me")
async def me(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
):
    user = AuthService.get_current_user(creds.credentials, db)
    return {"id": user.id, "email": user.email, "full_name": user.full_name}


@router.patch("/me")
async def update_me(
    body: ProfileUpdateRequest,
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
):
    user = AuthService.get_current_user(creds.credentials, db)
    user = AuthService.update_profile(user, body, db)
    return {"id": user.id, "email": user.email, "full_name": user.full_name}


@router.post("/logout")
async def logout():
    # Stateless JWT — client discards tokens locally.
    # Add Redis blacklist here when token revocation is required.
    return {"success": True, "message": "Logged out"}


# ── Google OAuth ──────────────────────────────────────────────────────────────

@router.get("/google")
async def google_login():
    url = AuthService.get_google_auth_url(GOOGLE_REDIRECT_URI)
    return RedirectResponse(url)


@router.get("/google/callback")
async def google_callback(code: str, db: Session = Depends(get_db)):
    user = AuthService.handle_google_callback(code, GOOGLE_REDIRECT_URI, db)

    # Store a one-time code in Redis (30 s TTL) — never put JWTs in URLs
    one_time_code = secrets.token_urlsafe(32)
    redis_client.setex(f"oauth_code:{one_time_code}", 30, str(user.id))

    # /callback, not /auth/callback — the frontend page lives in the (auth) route *group*,
    # and Next.js route groups don't contribute a path segment.
    return RedirectResponse(
        f"{settings.FRONTEND_URL}/callback?code={one_time_code}"
    )
