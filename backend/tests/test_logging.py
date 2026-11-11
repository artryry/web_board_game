import json
import logging
from collections.abc import Callable, Iterator
from io import StringIO
from typing import Any

import pytest
import structlog

from app.core.config import get_settings
from app.core.logging_config import REDACTED, StepTimer, configure_logging, get_logger
from tests.helpers import logged, make_settings

Configure = Callable[..., StringIO]


@pytest.fixture
def configure() -> Iterator[Configure]:
    """Reconfigures logging to write into a buffer, and restores the app's setup afterwards."""

    def _configure(**overrides: Any) -> StringIO:
        buffer = StringIO()
        configure_logging(make_settings(**({"log_format": "json"} | overrides)), stream=buffer)
        return buffer

    yield _configure
    configure_logging(get_settings())


def json_lines(buffer: StringIO) -> list[dict[str, Any]]:
    return [json.loads(line) for line in buffer.getvalue().splitlines()]


def test_json_lines_start_with_the_common_fields(configure: Configure) -> None:
    buffer = configure()
    structlog.contextvars.bind_contextvars(request_id="3f2a9c1e", user_id="u1")

    get_logger("app.test").info("thing.happened", count=2)

    assert buffer.getvalue().startswith('{"ts":')
    assert '"level":"info"' in buffer.getvalue()
    (line,) = json_lines(buffer)
    assert list(line)[:6] == ["ts", "level", "event", "logger", "request_id", "user_id"]
    assert line["level"] == "info"
    assert line["event"] == "thing.happened"
    assert line["logger"] == "app.test"
    assert line["count"] == 2
    assert line["ts"].endswith("Z")


def test_secret_keys_are_redacted_at_any_depth(configure: Configure) -> None:
    buffer = configure()

    get_logger("app.test").info(
        "thing.happened",
        password="hunter2",
        refresh="refresh-token",
        nested={"access": "access-token", "count": 1},
        items=[{"upload_url": "https://r2.test/put"}],
    )

    (line,) = json_lines(buffer)
    assert line["password"] == REDACTED
    assert line["refresh"] == REDACTED
    assert line["nested"] == {"access": REDACTED, "count": 1}
    assert line["items"] == [{"upload_url": REDACTED}]


def test_secrets_in_text_are_scrubbed(configure: Configure) -> None:
    buffer = configure()
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"

    get_logger("app.test").warning(
        "thing.failed",
        detail=f"token {jwt}",
        url="https://r2.test/k?X-Amz-Credential=AKIDEXAMPLE&X-Amz-Signature=5ig0123456789",
        socket="/ws/rooms/ABC?token=secret-token",
        database="postgresql://cardtable:pa55word@db:5432/cardtable",
    )

    output = buffer.getvalue()
    for secret in (jwt, "AKIDEXAMPLE", "5ig0123456789", "secret-token", "pa55word"):
        assert secret not in output
    (line,) = json_lines(buffer)
    assert line["database"] == f"postgresql://cardtable:{REDACTED}@db:5432/cardtable"


def test_tracebacks_are_text_and_scrubbed(configure: Configure) -> None:
    buffer = configure()

    try:
        raise ValueError("connect to redis://default:pa55word@cache:6379 failed")
    except ValueError:
        get_logger("app.test").exception("thing.crashed")

    (line,) = json_lines(buffer)
    assert line["level"] == "error"
    assert "Traceback" in line["exception"]
    assert "ValueError" in line["exception"]
    assert "pa55word" not in line["exception"]


def test_loggers_made_before_the_setup_keep_working(configure: Configure) -> None:
    early = logging.getLogger("app.made_early")
    buffer = configure()

    early.warning("plain %s line", "stdlib")

    (line,) = json_lines(buffer)
    assert (line["event"], line["logger"], line["level"]) == (
        "plain stdlib line",
        "app.made_early",
        "warning",
    )


def test_uvicorn_lines_get_the_same_shape(configure: Configure) -> None:
    buffer = configure()

    logging.getLogger("uvicorn.error").info("Started server process [%d]", 42)

    (line,) = json_lines(buffer)
    assert (line["event"], line["logger"], line["level"]) == (
        "Started server process [42]",
        "uvicorn.error",
        "info",
    )


def test_uvicorns_own_access_log_is_off(configure: Configure) -> None:
    configure()

    # uvicorn writes access lines only while this logger has handlers.
    assert not logging.getLogger("uvicorn.access").hasHandlers()


def test_uvicorn_websocket_lines_lose_the_query_string(configure: Configure) -> None:
    buffer = configure()

    logging.getLogger("uvicorn.error").info(
        '%s - "WebSocket %s" [accepted]', "203.0.113.5:4000", "/ws/rooms/ABC?token=abc.def"
    )

    (line,) = json_lines(buffer)
    assert line["event"] == '203.0.113.5:4000 - "WebSocket /ws/rooms/ABC" [accepted]'


def test_log_level_applies_to_our_code_only(configure: Configure) -> None:
    buffer = configure(log_level="debug")

    get_logger("app.test").debug("thing.detail")
    # botocore's DEBUG output includes signed request headers.
    logging.getLogger("botocore.endpoint").debug("Sending http request")
    logging.getLogger("sqlalchemy.engine").info("SELECT 1")

    assert [line["event"] for line in json_lines(buffer)] == ["thing.detail"]


def test_info_hides_debug_lines(configure: Configure) -> None:
    buffer = configure(log_level="INFO")

    get_logger("app.test").debug("thing.detail")

    assert buffer.getvalue() == ""


def test_console_format_is_one_readable_line(configure: Configure) -> None:
    buffer = configure(log_format="console")

    get_logger("app.test").info("thing.happened", count=2)

    output = buffer.getvalue()
    assert output.count("\n") == 1
    assert "thing.happened" in output
    assert "count=2" in output
    assert not output.startswith("{")


def test_auto_format_writes_json_outside_a_terminal(configure: Configure) -> None:
    buffer = configure(log_format="auto")

    get_logger("app.test").info("thing.happened")

    assert json_lines(buffer)[0]["event"] == "thing.happened"


def test_log_settings_accept_any_case() -> None:
    settings = make_settings(log_level="debug", log_format="JSON")

    assert (settings.log_level, settings.log_format) == ("DEBUG", "json")


def test_step_timer_logs_each_step_with_its_duration(logs: list[dict[str, Any]]) -> None:
    steps = StepTimer(get_logger("app.test"), "thing.step")

    steps.done("loaded", items=3)
    steps.done("saved")

    lines = logged(logs, "thing.step")
    assert [(line["step"], line["log_level"]) for line in lines] == [
        ("loaded", "debug"),
        ("saved", "debug"),
    ]
    assert lines[0]["items"] == 3
    assert all(isinstance(line["duration_ms"], int) for line in lines)
