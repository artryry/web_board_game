"""Background tasks that log like the rest of the app (coding-standards §2).

A task created inside a request would copy that request's log context, and every line it logs
would carry the request's ids. `spawn` starts each task with an empty context instead, binds the
task's own fields (`room_code`, `game_id`), and logs the task's own exception: nothing else
awaits these tasks to see it.
"""

import asyncio
import contextlib
import contextvars
from collections.abc import Coroutine
from typing import Any

import structlog

from app.core.logging_config import get_logger

log = get_logger(__name__)


def spawn(coro: Coroutine[Any, Any, None], *, name: str, **fields: object) -> asyncio.Task[None]:
    """Runs `coro` in a new task with an empty log context plus `fields`."""

    async def run() -> None:
        structlog.contextvars.bind_contextvars(**fields)
        try:
            await coro
        except Exception:
            # Cancellation isn't an Exception, so it passes through.
            log.exception("task.failed", task=name)

    return asyncio.create_task(run(), name=name, context=contextvars.Context())


async def cancel_and_wait(task: asyncio.Task[None]) -> None:
    """Cancels a task and waits until it has stopped."""
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
