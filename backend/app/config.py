from pathlib import Path
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://testmaker:testmaker@localhost:5432/review_test"
    data_dir: str = "./data/uploads"
    app_password: str = ""
    secret_key: str = ""
    static_dir: str = "./static"
    cors_origins: str = "*"

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if not value:
            return value
        if value.startswith("postgres://"):
            return "postgresql+psycopg://" + value[len("postgres://") :]
        if value.startswith("postgresql://") and "+psycopg" not in value:
            return "postgresql+psycopg://" + value[len("postgresql://") :]
        return value

    @property
    def upload_path(self) -> Path:
        path = Path(self.data_dir).resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def effective_secret(self) -> str:
        if self.secret_key:
            return self.secret_key
        return f"review-test-secret::{self.app_password or 'dev-local'}"


settings = Settings()
