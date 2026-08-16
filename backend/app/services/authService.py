import bcrypt
import httpx
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis_client import redis_client
from app.core.security import (
    check_rate_limit,
    create_access_token,
    create_refresh_token,
    decode_token,
    reset_rate_limit,
)
from app.models.user_dtl import User
from app.schemas.LoginRequest import LoginRequest
from app.schemas.ProfileUpdateRequest import ProfileUpdateRequest
from app.schemas.RegisterRequest import RegisterRequest

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"


def _user_dict(user: User) -> dict:
    return {"id": user.id, "email": user.email, "full_name": user.full_name}


class AuthService:

    def login(request: LoginRequest, db: Session, ip: str):
        check_rate_limit(redis_client, ip)

        user = db.query(User).filter(User.email == request.email.lower().strip()).first()

        # Constant-time-ish check — don't reveal whether the email exists
        if not user or not user.password:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
            )

        if not bcrypt.checkpw(
            request.password.encode("utf-8"), user.password.encode("utf-8")
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
            )

        reset_rate_limit(redis_client, ip)  # clear counter on success

        return {
            "success": True,
            "access_token": create_access_token(user.id),
            "refresh_token": create_refresh_token(user.id),
            "token_type": "bearer",
            "user": _user_dict(user),
        }

    def register(request: RegisterRequest, db: Session):
        email = request.email.lower().strip()

        if db.query(User).filter(User.email == email).first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists.",
            )

        hashed = bcrypt.hashpw(
            request.password.encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8")

        user = User(
            full_name=request.full_name.strip(),
            email=email,
            password=hashed,
        )
        db.add(user)
        db.commit()

        return {"success": True, "message": "Account created successfully."}

    def refresh_tokens(refresh_token: str, db: Session):
        user_id = decode_token(refresh_token, "refresh")
        user = db.query(User).filter(User.id == user_id).first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )

        return {
            "success": True,
            "access_token": create_access_token(user.id),
            "refresh_token": create_refresh_token(user.id),
            "token_type": "bearer",
            "user": _user_dict(user),
        }

    def update_profile(user: User, body: ProfileUpdateRequest, db: Session) -> User:
        if body.full_name is not None:
            user.full_name = body.full_name

        if body.new_password is not None:
            if user.password is not None:
                if not body.current_password or not bcrypt.checkpw(
                    body.current_password.encode("utf-8"), user.password.encode("utf-8")
                ):
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Current password is incorrect",
                    )
            user.password = bcrypt.hashpw(
                body.new_password.encode("utf-8"), bcrypt.gensalt()
            ).decode("utf-8")

        db.commit()
        db.refresh(user)
        return user

    def get_current_user(token: str, db: Session) -> User:
        user_id = decode_token(token, "access")
        user = db.query(User).filter(User.id == user_id).first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )

        return user

    def get_google_auth_url(redirect_uri: str) -> str:
        params = {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
            "prompt": "consent",
        }
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        return f"{GOOGLE_AUTH_URL}?{qs}"

    def handle_google_callback(code: str, redirect_uri: str, db: Session) -> User:
        with httpx.Client() as client:
            token_res = client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )

        if token_res.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to exchange Google auth code",
            )

        access_token = token_res.json().get("access_token")

        with httpx.Client() as client:
            info_res = client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )

        if info_res.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to fetch user info from Google",
            )

        data = info_res.json()
        google_id = data.get("id")
        email = data.get("email", "").lower().strip()
        full_name = data.get("name", "")

        if not email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Google account has no associated email",
            )

        user = db.query(User).filter(User.google_id == google_id).first()

        if not user:
            user = db.query(User).filter(User.email == email).first()
            if user:
                # Link existing email account to Google
                user.google_id = google_id
            else:
                user = User(full_name=full_name, email=email, google_id=google_id)
                db.add(user)

        db.commit()
        db.refresh(user)
        return user

    def exchange_oauth_code(code: str, db: Session):
        user_id_str = redis_client.get(f"oauth_code:{code}")

        if not user_id_str:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Authorization code is invalid or has expired",
            )

        # One-time use — delete immediately after reading
        redis_client.delete(f"oauth_code:{code}")

        user = db.query(User).filter(User.id == int(user_id_str)).first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )

        return {
            "success": True,
            "access_token": create_access_token(user.id),
            "refresh_token": create_refresh_token(user.id),
            "token_type": "bearer",
            "user": _user_dict(user),
        }
