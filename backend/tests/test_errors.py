from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app


@pytest.fixture
async def bare_client() -> AsyncIterator[AsyncClient]:
    # Unknown routes and wrong methods fail before any dependency runs, so no DB is needed.
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as c:
        yield c


async def test_unknown_route_uses_error_shape(bare_client: AsyncClient) -> None:
    response = await bare_client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {"detail": {"code": "not_found", "message": "Not Found"}}


async def test_wrong_method_uses_error_shape_and_keeps_headers(bare_client: AsyncClient) -> None:
    response = await bare_client.get("/api/auth/login")

    assert response.status_code == 405
    assert response.json() == {
        "detail": {"code": "method_not_allowed", "message": "Method Not Allowed"}
    }
    assert response.headers["allow"] == "POST"
