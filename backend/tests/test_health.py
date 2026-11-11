from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.core.deps import get_db, get_redis, get_s3
from app.main import create_app
from tests.helpers import access_line, logged, make_settings


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


async def _client(redis_healthy: bool) -> AsyncIterator[AsyncClient]:
    # ASGITransport doesn't run the lifespan, so no real services are touched.
    app = create_app()

    async def fake_db() -> AsyncIterator[FakeSession]:
        yield FakeSession()

    app.dependency_overrides[get_db] = fake_db
    app.dependency_overrides[get_redis] = lambda: FakeRedis(redis_healthy)
    app.dependency_overrides[get_s3] = FakeS3
    app.dependency_overrides[get_settings] = lambda: make_settings()
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


async def test_liveness_touches_no_service() -> None:
    # No dependency overrides and no lifespan: touching the DB, Redis or R2 would fail.
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_health_degraded_when_redis_down(redis_down_client: AsyncClient) -> None:
    response = await redis_down_client.get("/api/health")

    assert response.status_code == 503
    assert response.json() == {
        "status": "degraded",
        "postgres": True,
        "redis": False,
        "storage": True,
    }


async def test_a_failed_check_is_a_warning(
    redis_down_client: AsyncClient, logs: list[dict[str, Any]]
) -> None:
    await redis_down_client.get("/api/health")

    (line,) = logged(logs, "health.check_failed")
    assert (line["check"], line["log_level"]) == ("redis", "warning")
    assert line["exc_info"] is True
    assert access_line(logs, "/api/health")["log_level"] == "error"
