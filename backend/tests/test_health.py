from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import HttpUrl, SecretStr

from app.core.config import Settings, get_settings
from app.core.deps import get_db, get_redis, get_s3
from app.main import create_app


class FakeSession:
    async def execute(self, _statement: object) -> None:
        return None


class FakeRedis:
    def __init__(self, healthy: bool) -> None:
        self.healthy = healthy

    async def ping(self) -> bool:
        if not self.healthy:
            raise ConnectionError("redis is down")
        return True


class FakeS3:
    async def head_bucket(self, Bucket: str) -> dict[str, object]:  # noqa: N803 - boto3 kwarg name
        return {}


def _test_settings() -> Settings:
    return Settings(
        database_url=SecretStr("postgresql+asyncpg://test:test@localhost:5432/test"),
        redis_url="redis://localhost:6379/0",
        redis_password=SecretStr("test"),
        r2_endpoint=HttpUrl("https://test.r2.cloudflarestorage.com"),
        r2_access_key_id="test",
        r2_secret_access_key=SecretStr("test"),
        r2_bucket="test-bucket",
        jwt_secret=SecretStr("test"),
    )


async def _client(redis_healthy: bool) -> AsyncIterator[AsyncClient]:
    # ASGITransport doesn't run the lifespan, so no real services are touched.
    app = create_app()

    async def fake_db() -> AsyncIterator[FakeSession]:
        yield FakeSession()

    app.dependency_overrides[get_db] = fake_db
    app.dependency_overrides[get_redis] = lambda: FakeRedis(redis_healthy)
    app.dependency_overrides[get_s3] = FakeS3
    app.dependency_overrides[get_settings] = _test_settings
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


@pytest.fixture
async def healthy_client() -> AsyncIterator[AsyncClient]:
    async for client in _client(redis_healthy=True):
        yield client


@pytest.fixture
async def redis_down_client() -> AsyncIterator[AsyncClient]:
    async for client in _client(redis_healthy=False):
        yield client


async def test_health_ok(healthy_client: AsyncClient) -> None:
    response = await healthy_client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "postgres": True, "redis": True, "storage": True}


async def test_health_degraded_when_redis_down(redis_down_client: AsyncClient) -> None:
    response = await redis_down_client.get("/api/health")

    assert response.status_code == 503
    assert response.json() == {
        "status": "degraded",
        "postgres": True,
        "redis": False,
        "storage": True,
    }
