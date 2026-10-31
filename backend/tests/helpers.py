from pydantic import HttpUrl, SecretStr

from app.core.config import Settings


def make_settings() -> Settings:
    """Settings with fixed, fake values, so tests never depend on the local .env."""
    return Settings(
        database_url=SecretStr("postgresql+asyncpg://test:test@localhost:5432/test"),
        redis_url="redis://localhost:6379/0",
        redis_password=SecretStr("test"),
        r2_endpoint=HttpUrl("https://test.r2.cloudflarestorage.com"),
        r2_access_key_id="test",
        r2_secret_access_key=SecretStr("test"),
        r2_bucket="test-bucket",
        jwt_secret=SecretStr("test-jwt-secret-that-is-at-least-32-chars"),
        jwt_algorithm="HS256",
        access_token_ttl_min=15,
        refresh_token_ttl_days=30,
    )
