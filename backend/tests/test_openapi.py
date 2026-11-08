from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    # The schema and docs routes need no services, and ASGITransport doesn't run the lifespan.
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def test_openapi_schema_is_under_api(client: AsyncClient) -> None:
    response = await client.get("/api/openapi.json")

    assert response.status_code == 200
    assert "/api/auth/login" in response.json()["paths"]


async def test_docs_are_under_api(client: AsyncClient) -> None:
    response = await client.get("/api/docs")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "/api/openapi.json" in response.text


async def test_query_parameters_are_flat(client: AsyncClient) -> None:
    # The frontend's types are generated from this schema, so an object-typed query parameter
    # (a query model FastAPI didn't flatten) would make the typed client ask for the wrong shape.
    schema = (await client.get("/api/openapi.json")).json()

    for path, operations in schema["paths"].items():
        for method, operation in operations.items():
            for param in operation.get("parameters", []):
                where = f"{method.upper()} {path} ?{param['name']}"
                assert "$ref" not in param["schema"], where


async def test_card_list_query_lists_filters_and_paging(client: AsyncClient) -> None:
    schema = (await client.get("/api/openapi.json")).json()

    params = schema["paths"]["/api/cards"]["get"]["parameters"]

    assert {p["name"] for p in params} == {
        "origin_id",
        "kind",
        "group_id",
        "ungrouped",
        "limit",
        "offset",
    }
    assert not any(p["required"] for p in params)


@pytest.mark.parametrize("path", ["/openapi.json", "/docs", "/redoc"])
async def test_old_schema_and_docs_urls_are_gone(client: AsyncClient, path: str) -> None:
    response = await client.get(path)

    assert response.status_code == 404
