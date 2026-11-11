import re
from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi import FastAPI, WebSocket
from httpx import ASGITransport, AsyncClient
from starlette.types import Message

from app.core import middleware
from app.core.errors import AppError
from app.main import create_app
from tests.helpers import AuthedUser, access_line, logged

GENERATED_ID = re.compile(r"[0-9a-f]{32}")


def _app() -> FastAPI:
    """The real app (no services: ASGITransport doesn't run the lifespan) plus test routes."""
    app = create_app()

    @app.get("/api/test/items/{item_id}")
    async def item(item_id: int) -> dict[str, int]:
        return {"id": item_id}

    @app.get("/api/test/conflict")
    async def conflict() -> None:
        raise AppError(409, "in_use", "Still used")

    @app.get("/api/test/crash")
    async def crash() -> None:
        raise RuntimeError("database fell over")

    @app.websocket("/ws/test/crash")
    async def crash_socket(websocket: WebSocket) -> None:
        await websocket.accept()
        raise RuntimeError("socket fell over")

    return app


@pytest.fixture
async def bare_client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as c:
        yield c


async def test_a_request_id_is_made_and_returned(
    bare_client: AsyncClient, logs: list[dict[str, Any]]
) -> None:
    response = await bare_client.get("/api/test/items/1")

    request_id = response.headers["x-request-id"]
    assert GENERATED_ID.fullmatch(request_id)
    assert access_line(logs, "/api/test/items/1")["request_id"] == request_id


async def test_a_valid_incoming_request_id_is_kept(
    bare_client: AsyncClient, logs: list[dict[str, Any]]
) -> None:
    sent = "5b0e2c4a-9d1f-4e3b-8a7c-1d2e3f4a5b6c"

    response = await bare_client.get("/api/test/items/1", headers={"X-Request-ID": sent})

    assert response.headers["x-request-id"] == sent
    assert access_line(logs, "/api/test/items/1")["request_id"] == sent


@pytest.mark.parametrize("sent", ["short", "has spaces in it", "x" * 65, "line\nbreak-123"])
async def test_an_invalid_incoming_request_id_is_replaced(
    bare_client: AsyncClient, sent: str
) -> None:
    response = await bare_client.get("/api/test/items/1", headers={"X-Request-ID": sent})

    assert GENERATED_ID.fullmatch(response.headers["x-request-id"])


async def test_the_access_line_describes_the_request(
    bare_client: AsyncClient, logs: list[dict[str, Any]]
) -> None:
    await bare_client.get("/api/test/items/7?secret=1")

    line = access_line(logs, "/api/test/items/7")
    assert line["log_level"] == "info"
    assert line["logger"] == "app.access"
    assert line["method"] == "GET"
    assert line["route"] == "/api/test/items/{item_id}"
    assert line["status"] == 200
    assert isinstance(line["duration_ms"], int)
    assert line["client_ip"] == "127.0.0.1"
    # The query string is never logged.
    assert "secret" not in str(line)
    assert "user_id" not in line
    assert "error_code" not in line


async def test_each_request_gets_exactly_one_access_line(
    bare_client: AsyncClient, logs: list[dict[str, Any]]
) -> None:
    await bare_client.get("/api/test/items/1")
    await bare_client.get("/api/test/conflict")

    assert len(logged(logs, "http.request")) == 2


@pytest.mark.parametrize(
    ("path", "status", "code"),
    [
        ("/api/test/conflict", 409, "in_use"),
        ("/api/test/nothing-here", 404, "not_found"),
        ("/api/test/items/not-a-number", 422, "validation_error"),
    ],
)
async def test_an_error_answer_is_info_with_its_code(
    bare_client: AsyncClient, logs: list[dict[str, Any]], path: str, status: int, code: str
) -> None:
    response = await bare_client.get(path)

    assert response.status_code == status
    line = access_line(logs, path)
    assert (line["log_level"], line["status"], line["error_code"]) == ("info", status, code)


async def test_validation_errors_keep_fastapis_body(bare_client: AsyncClient) -> None:
    response = await bare_client.get("/api/test/items/not-a-number")

    assert isinstance(response.json()["detail"], list)


@pytest.mark.parametrize("path", ["/api/health/live", "/", "/assets/app.js"])
async def test_health_probes_and_pages_are_debug(
    bare_client: AsyncClient, logs: list[dict[str, Any]], path: str
) -> None:
    await bare_client.get(path)

    line = access_line(logs, path)
    # Pages and files 404 here (no built frontend), so only the health probe is quiet.
    expected = "debug" if line["status"] < 400 else "info"
    assert line["log_level"] == expected


async def test_a_slow_request_is_a_warning(
    bare_client: AsyncClient, logs: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(middleware, "SLOW_REQUEST_S", 0.0)

    await bare_client.get("/api/test/items/1")

    assert access_line(logs, "/api/test/items/1")["log_level"] == "warning"


async def test_a_crash_answers_500_with_the_request_id(bare_client: AsyncClient) -> None:
    response = await bare_client.get("/api/test/crash")

    request_id = response.headers["x-request-id"]
    assert response.status_code == 500
    assert response.json() == {
        "detail": {
            "code": "internal_error",
            "message": "Something went wrong.",
            "request_id": request_id,
        }
    }


async def test_a_crash_is_one_error_line_with_the_exception(
    bare_client: AsyncClient, logs: list[dict[str, Any]]
) -> None:
    await bare_client.get("/api/test/crash")

    (line,) = [entry for entry in logs if entry.get("path") == "/api/test/crash"]
    assert line["event"] == "http.request"
    assert line["log_level"] == "error"
    assert (line["status"], line["error_code"]) == (500, "internal_error")
    assert isinstance(line["exc_info"], RuntimeError)


async def test_the_access_line_names_the_user(
    client: AsyncClient, alice: AuthedUser, logs: list[dict[str, Any]]
) -> None:
    await client.get("/api/auth/me", headers=alice.headers)

    line = access_line(logs, "/api/auth/me")
    assert line["user_id"] == str(alice.id)
    assert line["route"] == "/api/auth/me"


async def test_routes_of_included_routers_show_their_full_template(
    client: AsyncClient, alice: AuthedUser, logs: list[dict[str, Any]]
) -> None:
    await client.get("/api/share/NOPE123456", headers=alice.headers)
    await client.get("/api/health/live")

    assert access_line(logs, "/api/share/NOPE123456")["route"] == "/api/share/{code}"
    assert access_line(logs, "/api/health/live")["route"] == "/api/health/live"


async def test_a_crashed_websocket_is_closed_and_logged(logs: list[dict[str, Any]]) -> None:
    # Driven through ASGI directly: httpx has no WebSocket client.
    incoming: list[Message] = [{"type": "websocket.connect"}]
    sent: list[Message] = []

    async def receive() -> Message:
        return incoming.pop(0)

    async def send(message: Message) -> None:
        sent.append(message)

    scope = {
        "type": "websocket",
        "asgi": {"version": "3.0"},
        "scheme": "ws",
        "path": "/ws/test/crash",
        "raw_path": b"/ws/test/crash",
        "root_path": "",
        "query_string": b"token=abc",
        "headers": [],
        "client": ("127.0.0.1", 50000),
        "server": ("test", 80),
        "subprotocols": [],
    }
    await _app()(scope, receive, send)

    assert [message["type"] for message in sent] == ["websocket.accept", "websocket.close"]
    assert sent[-1]["code"] == 1011
    (line,) = logged(logs, "ws.unhandled_error")
    assert line["path"] == "/ws/test/crash"
    assert isinstance(line["exc_info"], RuntimeError)
    assert GENERATED_ID.fullmatch(line["request_id"])
