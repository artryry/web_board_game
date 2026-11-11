"""Writes the browser's warnings and errors to the server log, within a rate limit."""

import logging
import time
from collections.abc import Callable, Sequence
from typing import Any

from app.core.logging_config import get_logger
from app.schemas.client_log import ClientLogEntry

# Each entry becomes one line on this logger, so `"logger":"app.client"` finds them all.
client_log = get_logger("app.client")
log = get_logger(__name__)

PER_SOURCE_PER_MINUTE = 60
OVERALL_PER_MINUTE = 600
USER_AGENT_MAX_LENGTH = 200

_LEVELS = {"warn": logging.WARNING, "error": logging.ERROR}


class ClientLogLimiter:
    """How many entries a user (or, when anonymous, an IP) may log per one-minute window.

    Kept in process, since the API runs one worker. The IP comes from X-Forwarded-For, which a
    client can fake, so there is an overall cap as well. The counts start over each window, so
    the memory stays bounded.
    """

    def __init__(
        self,
        per_source: int = PER_SOURCE_PER_MINUTE,
        overall: int = OVERALL_PER_MINUTE,
        window_s: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._per_source = per_source
        self._overall = overall
        self._window_s = window_s
        self._clock = clock
        self._window_start = clock()
        self._counts: dict[str, int] = {}
        self._total = 0
        self._warned = False

    def admit(self, source: str, count: int) -> int:
        """How many of `count` entries from `source` may be logged now."""
        now = self._clock()
        if now - self._window_start >= self._window_s:
            self._window_start = now
            self._counts.clear()
            self._total = 0
            self._warned = False

        used = self._counts.get(source, 0)
        allowed = max(0, min(count, self._per_source - used, self._overall - self._total))
        self._counts[source] = used + allowed
        self._total += allowed

        dropped = count - allowed
        if dropped and not self._warned:
            # Once per window, so a flood can't flood the log with its own warnings.
            self._warned = True
            reason = "overall_limit" if self._total >= self._overall else "source_limit"
            log.warning(
                "client_logs.dropped",
                dropped=dropped,
                reason=reason,
                source=source.split(":", 1)[0],
                note="later drops in this minute are not logged",
            )
        return allowed


def record(
    entries: Sequence[ClientLogEntry],
    *,
    source: str,
    user_agent: str | None,
    limiter: ClientLogLimiter,
) -> None:
    """Logs each admitted entry as `web.<event>`. The request id and the user id come from the
    log context of the request that sent them."""
    allowed = limiter.admit(source, len(entries))
    for entry in entries[:allowed]:
        # Prefixed, so a browser can't write a line that looks like the server's own.
        event = "web." + entry.event
        fields: dict[str, Any] = {
            "source": "web",
            "page": entry.page,
            "client_ts": entry.client_ts.isoformat(),
            "message": entry.message,
            "context": entry.context,
            "user_agent": (user_agent or "")[:USER_AGENT_MAX_LENGTH],
        }
        if entry.stack is not None:
            fields["stack"] = entry.stack
        if entry.breadcrumbs:
            fields["breadcrumbs"] = [crumb.model_dump(mode="json") for crumb in entry.breadcrumbs]
        client_log.log(_LEVELS[entry.level], event, **fields)
