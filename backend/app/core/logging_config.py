"""Logging for the whole process.

Our code logs through structlog: an event name plus fields, for example
`log.info("share.imported", kind="deck", cards=12)`. Lines from stdlib loggers (uvicorn, Alembic,
SQLAlchemy) go through the same formatter, so every line has one shape: coloured in a terminal,
one JSON object per line in production.
"""

import logging
import logging.config
import re
import sys
import time
from collections.abc import Mapping
from typing import Any, TextIO

import structlog
from structlog.typing import EventDict, Processor, WrappedLogger

from app.core.config import Settings

REDACTED = "[redacted]"

# A value whose key contains one of these parts is never logged, at any depth.
_SECRET_KEY_PARTS = (
    "password",
    "token",
    "secret",
    "authorization",
    "cookie",
    "signature",
    "credential",
    "upload_url",
)
# The fields of auth_service.TokenPair. Matched whole, since "access" is a common word.
_SECRET_KEYS = frozenset({"access", "refresh"})

# Secrets that can hide inside free text: exception messages, URLs, third-party lines.
_SCRUBBERS = (
    (re.compile(r"eyJ[\w-]+\.[\w-]+\.[\w-]*"), REDACTED),  # a JWT
    (re.compile(r"(?i)([?&](?:access_)?token=)[^&\s\"']+"), rf"\1{REDACTED}"),
    (
        re.compile(r"(?i)(X-Amz-(?:Signature|Credential|Security-Token)=)[^&\s\"']+"),
        rf"\1{REDACTED}",
    ),
    (re.compile(r"(://[^/\s:@]+:)[^@\s/]+@"), rf"\1{REDACTED}@"),  # user:password@ in a URL
)

# JSON lines start with these, so they read the same way in Render's log viewer.
_LEADING_KEYS = ("ts", "level", "event", "logger", "request_id", "user_id")

_THIRD_PARTY_LEVELS = {
    "uvicorn": "INFO",
    "uvicorn.error": "INFO",
    "alembic": "INFO",
    "sqlalchemy.engine": "WARNING",
}


def is_secret_key(key: str) -> bool:
    lowered = key.lower()
    return lowered in _SECRET_KEYS or any(part in lowered for part in _SECRET_KEY_PARTS)


def scrub(text: str) -> str:
    for pattern, replacement in _SCRUBBERS:
        text = pattern.sub(replacement, text)
    return text


def _clean(value: Any) -> Any:
    if value is None or isinstance(value, bool | int | float):
        return value
    if isinstance(value, str):
        return scrub(value)
    if isinstance(value, Mapping):
        return {
            key: REDACTED if is_secret_key(str(key)) else _clean(item)
            for key, item in value.items()
        }
    if isinstance(value, list | tuple | set | frozenset):
        return [_clean(item) for item in value]
    # UUIDs, datetimes, enums and the like: their text form, which JSON can hold.
    return scrub(str(value))


def redact_secrets(_logger: WrappedLogger, _method: str, event_dict: EventDict) -> EventDict:
    """The safety net: drops secret-looking keys and scrubs secret-looking text everywhere."""
    return {
        key: REDACTED if is_secret_key(key) else _clean(value) for key, value in event_dict.items()
    }


def _leading_keys_first(_logger: WrappedLogger, _method: str, event_dict: EventDict) -> EventDict:
    leading = {key: event_dict.pop(key) for key in _LEADING_KEYS if key in event_dict}
    return {**leading, **event_dict}


class StripQueryStrings(logging.Filter):
    """uvicorn logs WebSocket handshakes with the full URL, and the planned game socket carries
    the access token in its query string (`?token=`). Paths in uvicorn's lines lose the query."""

    def filter(self, record: logging.LogRecord) -> bool:
        if record.name.startswith("uvicorn") and isinstance(record.args, tuple):
            record.args = tuple(_strip_query(arg) for arg in record.args)
        return True


def _strip_query(arg: object) -> object:
    if isinstance(arg, str) and arg.startswith("/") and "?" in arg:
        return arg.split("?", 1)[0]
    return arg


def _use_json(log_format: str, stream: TextIO) -> bool:
    if log_format == "auto":
        return not stream.isatty()
    return log_format == "json"


def configure_logging(settings: Settings, stream: TextIO | None = None) -> None:
    """Sets up logging for the process. Call it once: at import of app.main, or in alembic/env.py.

    Not from create_app(): the tests build an app per test, and reconfiguring would remove
    pytest's own capture handler each time.
    """
    out = stream if stream is not None else sys.stdout
    as_json = _use_json(settings.log_format, out)

    shared: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True, key="ts"),
    ]
    renderer: Processor = (
        # Compact, so a search for "level":"error" matches exactly.
        structlog.processors.JSONRenderer(separators=(",", ":"))
        if as_json
        else structlog.dev.ConsoleRenderer(
            colors=out.isatty(),
            timestamp_key="ts",
            exception_formatter=structlog.dev.plain_traceback,
        )
    )
    final: list[Processor] = [
        structlog.stdlib.ProcessorFormatter.remove_processors_meta,
        # Tracebacks become text here, without local variables, so the scrubber sees them too.
        structlog.processors.format_exc_info,
        redact_secrets,
    ]
    if as_json:
        final.append(_leading_keys_first)
    final.append(renderer)

    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            *shared,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.StackInfoRenderer(),
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        # Off, so tests can swap the processors (structlog.testing.capture_logs).
        cache_logger_on_first_use=False,
    )

    logging.config.dictConfig(
        {
            "version": 1,
            # Loggers made before this call (module-level ones) must keep working.
            "disable_existing_loggers": False,
            "filters": {"strip_query_strings": {"()": StripQueryStrings}},
            "formatters": {
                "structlog": {
                    "()": structlog.stdlib.ProcessorFormatter,
                    "processors": final,
                    "foreign_pre_chain": shared,
                }
            },
            "handlers": {
                "default": {
                    "class": "logging.StreamHandler",
                    "stream": out,
                    "formatter": "structlog",
                    "filters": ["strip_query_strings"],
                }
            },
            "root": {"level": "WARNING", "handlers": ["default"]},
            "loggers": {
                "app": {"level": settings.log_level},
                # uvicorn sets up its own handlers before it imports the app; these replace them,
                # so its lines reach the root handler.
                **{
                    name: {"level": level, "handlers": [], "propagate": True}
                    for name, level in _THIRD_PARTY_LEVELS.items()
                },
                # The request middleware writes the access line. uvicorn writes its own only
                # while this logger has handlers.
                "uvicorn.access": {"level": "WARNING", "handlers": [], "propagate": False},
            },
        }
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """A logger for one module: `log = get_logger(__name__)`. App loggers live under `app.`."""
    logger: structlog.stdlib.BoundLogger = structlog.stdlib.get_logger(name)
    return logger


def elapsed_ms(started: float) -> int:
    """Milliseconds since a `time.perf_counter()` reading."""
    return round((time.perf_counter() - started) * 1000)


class StepTimer:
    """Logs each step of a long flow at DEBUG, with the time it took.

    `steps = StepTimer(log, "share.import_step")`, then `steps.done("origins_copied", origins=2)`
    after each step. The lines are off in production unless LOG_LEVEL=DEBUG.
    """

    def __init__(self, logger: structlog.stdlib.BoundLogger, event: str) -> None:
        self._logger = logger
        self._event = event
        self._last = time.perf_counter()

    def done(self, step: str, **fields: object) -> None:
        self._logger.debug(self._event, step=step, duration_ms=elapsed_ms(self._last), **fields)
        self._last = time.perf_counter()
