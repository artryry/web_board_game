from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from tests.helpers import assert_error

INDEX_HTML = '<!doctype html><script src="/assets/index-abc123.js"></script>'
BUNDLE_JS = "console.log('card table')"


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    """A minimal Vite build, plus a file next to it that must never be served."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX_HTML)
    (dist / "assets" / "index-abc123.js").write_text(BUNDLE_JS)
    (dist / "favicon.svg").write_text("<svg/>")
    (tmp_path / "secret.txt").write_text("outside dist")
    return dist


@pytest.fixture
async def client(dist: Path) -> AsyncIterator[AsyncClient]:
    # ASGITransport doesn't run the lifespan, so no services are touched.
    app = create_app(frontend_dist_dir=dist)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


@pytest.mark.parametrize("path", ["/", "/login", "/cards/123/edit", "/assets-not-really"])
async def test_page_paths_get_index_html(client: AsyncClient, path: str) -> None:
    response = await client.get(path)

    assert response.status_code == 200
    assert response.text == INDEX_HTML
    assert response.headers["cache-control"] == "no-cache"


async def test_head_request_for_a_page(client: AsyncClient) -> None:
    response = await client.head("/login")

    assert response.status_code == 200
    assert response.content == b""


async def test_built_bundle_is_served(client: AsyncClient) -> None:
    response = await client.get("/assets/index-abc123.js")

    assert response.status_code == 200
    assert response.text == BUNDLE_JS


async def test_top_level_file_is_served(client: AsyncClient) -> None:
    response = await client.get("/favicon.svg")

    assert response.status_code == 200
    assert response.text == "<svg/>"


async def test_missing_bundle_is_not_found(client: AsyncClient) -> None:
    response = await client.get("/assets/index-gone.js")

    assert_error(response, 404, "not_found")


@pytest.mark.parametrize("path", ["/api", "/api/nope", "/ws/rooms/ABCD"])
async def test_backend_paths_never_get_the_app(client: AsyncClient, path: str) -> None:
    response = await client.get(path)

    assert_error(response, 404, "not_found")


async def test_api_routes_still_answer(client: AsyncClient) -> None:
    response = await client.get("/api/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_files_outside_dist_are_not_served(client: AsyncClient) -> None:
    response = await client.get("/..%2Fsecret.txt")

    assert response.status_code == 200
    assert response.text == INDEX_HTML


def test_missing_index_html_fails_at_startup(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="index.html"):
        create_app(frontend_dist_dir=tmp_path)
