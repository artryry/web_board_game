from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.client_logs import get_client_log_limiter
from app.core.config import get_settings
from app.core.security import create_access_token
from app.main import create_app
from app.services.client_log_service import ClientLogLimiter
from tests.helpers import access_line, assert_error, logged, make_settings

PATH = "/api/client-logs"
SETTINGS = make_settings()
CLIENT_TS = "2026-11-11T10:15:02.123Z"


@pytest.fixture
def limiter() -> ClientLogLimiter:
    return ClientLogLimiter(per_source=60, overall=600)


@pytest.fixture
async def client(limiter: ClientLogLimiter) -> AsyncIterator[AsyncClient]:
    # The endpoint touches no service: the token is only decoded.
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: SETTINGS
    app.dependency_overrides[get_client_log_limiter] = lambda: limiter
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def entry(**fields: Any) -> dict[str, Any]:
    return {
        "level": "error",
        "event": "api.request_failed",
        "message": "The request failed (HTTP 500).",
        "page": "/cards",
        "client_ts": CLIENT_TS,
        "context": {"status": 500, "request_id": "5b0e2c4a-9d1f"},
    } | fields


def crumb(event: str = "nav.page_viewed", **context: Any) -> dict[str, Any]:
    return {"ts": CLIENT_TS, "level": "debug", "event": event, "context": context}


async def test_entries_are_logged_as_web_events(
    client: AsyncClient, logs: list[dict[str, Any]]
) -> None:
    response = await client.post(
        PATH,
        json={"entries": [entry(stack="Error: boom\n  at x"), entry(level="warn", event="x.y")]},
        headers={"User-Agent": "Firefox/140"},
    )

    assert response.status_code == 204
    first, second = (e for e in logs if e["event"].startswith("web."))
    assert first["event"] == "web.api.request_failed"
    assert first["log_level"] == "error"
    assert first["logger"] == "app.client"
    assert first["source"] == "web"
    assert first["page"] == "/cards"
    assert first["client_ts"] == "2026-11-11T10:15:02.123000+00:00"
    assert first["context"] == {"status": 500, "request_id": "5b0e2c4a-9d1f"}
    assert first["stack"] == "Error: boom\n  at x"
    assert first["user_agent"] == "Firefox/140"
    assert first["request_id"] == response.headers["x-request-id"]
    assert "user_id" not in first
    assert (second["event"], second["log_level"]) == ("web.x.y", "warning")


async def test_a_valid_token_names_the_user(
    client: AsyncClient, logs: list[dict[str, Any]]
) -> None:
    user_id = uuid4()
    token = create_access_token(user_id, SETTINGS)

    response = await client.post(
        PATH, json={"entries": [entry()]}, headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 204
    (line,) = logged(logs, "web.api.request_failed")
    assert line["user_id"] == str(user_id)
    assert access_line(logs, PATH)["user_id"] == str(user_id)


@pytest.mark.parametrize("token_kind", ["expired", "garbage"])
async def test_a_bad_token_is_logged_anonymously(
    client: AsyncClient, logs: list[dict[str, Any]], token_kind: str
) -> None:
    long_ago = datetime.now(UTC) - timedelta(days=1)
    token = (
        create_access_token(uuid4(), SETTINGS, now=long_ago)
        if token_kind == "expired"
        else "not-a-token"
    )

    response = await client.post(
        PATH, json={"entries": [entry()]}, headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 204
    (line,) = logged(logs, "web.api.request_failed")
    assert "user_id" not in line
    (ignored,) = logged(logs, "auth.optional_token_ignored")
    assert ignored["log_level"] == "debug"


async def test_breadcrumbs_are_logged_nested(
    client: AsyncClient, logs: list[dict[str, Any]]
) -> None:
    crumbs = [crumb(route="/cards"), crumb("api.request", status=200, duration_ms=12)]

    response = await client.post(PATH, json={"entries": [entry(breadcrumbs=crumbs)]})

    assert response.status_code == 204
    (line,) = logged(logs, "web.api.request_failed")
    assert [c["event"] for c in line["breadcrumbs"]] == ["nav.page_viewed", "api.request"]
    assert line["breadcrumbs"][1]["context"] == {"status": 200, "duration_ms": 12}
    assert line["breadcrumbs"][0]["ts"] == "2026-11-11T10:15:02.123000Z"


async def test_the_access_line_is_debug(client: AsyncClient, logs: list[dict[str, Any]]) -> None:
    await client.post(PATH, json={"entries": [entry()]})

    assert access_line(logs, PATH)["log_level"] == "debug"


@pytest.mark.parametrize(
    "body",
    [
        {"entries": []},
        {"entries": [entry()] * 21},
        {"entries": [entry(level="info")]},
        {"entries": [entry(event="Not An Event")]},
        {"entries": [entry(event="http.request ok")]},
        {"entries": [entry(message="x" * 501)]},
        {"entries": [entry(stack="x" * 4001)]},
        {"entries": [entry(page="/" + "x" * 200)]},
        {"entries": [entry(context={f"k{i}": i for i in range(21)})]},
        {"entries": [entry(context={"Bad Key": 1})]},
        {"entries": [entry(context={"text": "x" * 201})]},
        {"entries": [entry(context={"nested": {"a": 1}})]},
        {"entries": [entry(breadcrumbs=[crumb()] * 21)]},
        {"entries": [entry(level="warn", breadcrumbs=[crumb()])]},
        {"entries": [entry(breadcrumbs=[crumb() | {"context": {f"k{i}": i for i in range(6)}}])]},
        {"entries": [entry(surprise=True)]},
    ],
)
async def test_bad_batches_are_refused(
    client: AsyncClient, logs: list[dict[str, Any]], body: dict[str, Any]
) -> None:
    response = await client.post(PATH, json=body)

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    assert not [e for e in logs if e["event"].startswith("web.")]


async def test_a_batch_over_64_kib_is_refused(client: AsyncClient) -> None:
    big = [entry(message="x" * 500, stack="y" * 4000)] * 20

    response = await client.post(PATH, json={"entries": big})

    assert_error(response, 413, "payload_too_large")


# Replaces the `limiter` fixture, which the client uses.
@pytest.mark.parametrize("limiter", [ClientLogLimiter(per_source=3, overall=100)])
async def test_entries_over_the_rate_limit_are_dropped_with_one_warning(
    client: AsyncClient, limiter: ClientLogLimiter, logs: list[dict[str, Any]]
) -> None:
    first = await client.post(PATH, json={"entries": [entry()] * 5})
    second = await client.post(PATH, json={"entries": [entry()]})

    assert (first.status_code, second.status_code) == (204, 204)
    assert len(logged(logs, "web.api.request_failed")) == 3
    (warning,) = logged(logs, "client_logs.dropped")
    assert warning["log_level"] == "warning"
    assert (warning["dropped"], warning["reason"], warning["source"]) == (2, "source_limit", "ip")


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_the_limit_starts_over_each_minute(logs: list[dict[str, Any]]) -> None:
    clock = FakeClock()
    limiter = ClientLogLimiter(per_source=2, overall=100, window_s=60, clock=clock)

    assert limiter.admit("ip:1", 3) == 2
    clock.now = 59
    assert limiter.admit("ip:1", 1) == 0
    clock.now = 60
    assert limiter.admit("ip:1", 3) == 2

    # One warning per window that dropped entries.
    assert [line["dropped"] for line in logged(logs, "client_logs.dropped")] == [1, 1]


def test_the_overall_cap_holds_across_sources(logs: list[dict[str, Any]]) -> None:
    limiter = ClientLogLimiter(per_source=10, overall=4, clock=FakeClock())

    assert limiter.admit("ip:1", 3) == 3
    assert limiter.admit("ip:2", 3) == 1
    assert limiter.admit("user:3", 3) == 0

    (warning,) = logged(logs, "client_logs.dropped")
    assert (warning["reason"], warning["source"]) == ("overall_limit", "ip")
