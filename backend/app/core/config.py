from functools import lru_cache
from pathlib import Path
from typing import Literal

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
    # Public URL of the bucket (custom domain or r2.dev); card and origin art is read from here.
    r2_public_base_url: HttpUrl

    # Art uploads. A presigned PUT can't cap the size on R2, so the size is checked when the URL
    # is requested and again with a HEAD when a card or origin is saved.
    upload_max_bytes: int = Field(default=2 * 1024 * 1024, gt=0)
    upload_url_ttl_s: int = Field(default=300, ge=60, le=3600)

    # HMAC algorithms only, since the secret is symmetric. 32 chars = 256 bits, the minimum
    # key size for HS256 (RFC 7518 §3.2).
    jwt_secret: SecretStr = Field(min_length=32)
    jwt_algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    access_token_ttl_min: int = Field(default=15, ge=1)
    refresh_token_ttl_days: int = Field(default=30, ge=1)
    # The refresh token travels in an HttpOnly cookie. Browsers accept Secure cookies on
    # http://localhost, so this stays on in development. Turn it off only to open the app over
    # plain HTTP on another host (for example a LAN IP).
    refresh_cookie_secure: bool = True

    health_check_timeout_s: float = 2.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
