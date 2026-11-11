from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, HttpUrl, SecretStr, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

# The repo-root .env is shared with docker-compose; resolve it absolutely so uvicorn,
# alembic and pytest find it regardless of the working directory.
ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


def to_asyncpg_url(raw: str) -> str:
    """Turns a libpq-style URL, as Neon hands it out, into one asyncpg accepts.

    asyncpg takes TLS as `ssl=<mode>` and fails on libpq's `sslmode` and `channel_binding`
    parameters. A URL that already targets asyncpg passes through unchanged.
    """
    try:
        url = make_url(raw)
    except ArgumentError:
        # The message would contain the URL, password included.
        raise ValueError("DATABASE_URL is not a valid database URL") from None
    if url.drivername in ("postgres", "postgresql"):
        url = url.set(drivername="postgresql+asyncpg")
    sslmode = url.query.get("sslmode")
    url = url.difference_update_query(["sslmode", "channel_binding"])
    if isinstance(sslmode, str) and "ssl" not in url.query:
        url = url.update_query_dict({"ssl": sslmode})
    return url.render_as_string(hide_password=False)


class Settings(BaseSettings):
    # Validation errors would otherwise echo the raw input, which may be a secret.
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore", hide_input_in_errors=True)

    database_url: SecretStr

    redis_url: str
    # Only needed when the password isn't part of REDIS_URL (the local docker-compose Redis).
    # Managed Redis such as Upstash puts it in the URL, which then takes precedence.
    redis_password: SecretStr | None = None

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

    # The built frontend (frontend/dist). Set in the production image, where the API serves the
    # app itself; unset in development, where nginx sends page requests to the Vite dev server.
    frontend_dist_dir: Path | None = None

    # Our own loggers only: third-party libraries stay at WARNING, since botocore's DEBUG output
    # includes signed request headers.
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    # "auto" writes coloured lines in a terminal and JSON lines otherwise (Docker, Render).
    log_format: Literal["auto", "console", "json"] = "auto"
    # Set by Render on every deploy; the startup line shows which commit is running.
    render_git_commit: str | None = None

    @field_validator("log_level", "log_format", mode="before")
    @classmethod
    def _any_case(cls, value: object, info: ValidationInfo) -> object:
        if not isinstance(value, str):
            return value
        return value.upper() if info.field_name == "log_level" else value.lower()

    @field_validator("database_url", mode="before")
    @classmethod
    def _use_asyncpg_url(cls, value: object) -> object:
        raw = value.get_secret_value() if isinstance(value, SecretStr) else value
        return to_asyncpg_url(raw) if isinstance(raw, str) else value


@lru_cache
def get_settings() -> Settings:
    return Settings()
