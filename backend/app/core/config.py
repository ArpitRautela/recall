from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8")

    DATABASE_URL: str
    REDIS_URL: str
    QDRANT_URL: str
    OPENAI_API_KEY: str
    GOOGLE_CLIENT_ID: str
    GOOGLE_CLIENT_SECRET: str
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    FRONTEND_URL: str = "http://localhost:3000"

    MINIO_ENDPOINT: str
    MINIO_ACCESS_KEY: str
    MINIO_SECRET_KEY: str
    MINIO_BUCKET: str
    MINIO_SECURE: bool = False

    # Total stored bytes allowed per user, enforced on upload.
    STORAGE_QUOTA_BYTES: int = 10 * 1024 * 1024 * 1024  # 10 GB


settings = Settings()