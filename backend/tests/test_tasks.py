"""Background tasks start with an empty log context and log their own exception."""

import asyncio
from typing import Any

import structlog

from app.core.logging_config import get_logger
from app.core.tasks import cancel_and_wait, spawn
from tests.helpers import logged

log = get_logger("app.tests.tasks")


async def test_a_task_has_its_own_fields_and_not_the_callers(logs: list[dict[str, Any]]) -> None:
    structlog.contextvars.bind_contextvars(request_id="from-a-request", user_id="u1")

    async def work() -> None:
        log.info("test.work")

    await spawn(work(), name="test.task", room_code="ABCDEF")

    (line,) = logged(logs, "test.work")
    assert line["room_code"] == "ABCDEF"
    assert "request_id" not in line
    assert "user_id" not in line


async def test_a_task_logs_its_own_exception(logs: list[dict[str, Any]]) -> None:
    async def fail() -> None:
        raise ValueError("boom")

    await spawn(fail(), name="test.task", room_code="ABCDEF")

    (line,) = logged(logs, "task.failed")
    assert (line["log_level"], line["task"], line["room_code"]) == ("error", "test.task", "ABCDEF")
    assert line["exc_info"] is True


async def test_cancelling_a_task_isnt_an_error(logs: list[dict[str, Any]]) -> None:
    async def wait_forever() -> None:
        await asyncio.Event().wait()

    task = spawn(wait_forever(), name="test.task")
    await asyncio.sleep(0)

    await cancel_and_wait(task)

    assert task.cancelled()
    assert not logged(logs, "task.failed")
