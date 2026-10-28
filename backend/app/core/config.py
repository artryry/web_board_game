from functools import lru_cache
from pathlib import Path

from pydantic import Field, HttpUrl, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

# The repo-root .env is shared with docker-compose; resolve it absolutely so uvicorn,
# alembic and pytest find it regardless of the working directory.
ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    database_url: SecretStr

    redis_url: str
    redis_password: SecretStr

    # Cloudflare R2, accessed through its S3-compatible API.
    r2_endpoint: HttpUrl
    r2_access_key_id: str = Field(min_length=1)
    r2_secret_access_key: SecretStr = Field(min_length=1)
    r2_bucket: str = Field(min_length=1)

    # Unused until M1 (auth).
    jwt_secret: SecretStr

    health_check_timeout_s: float = 2.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
