"""Request ids, the access line, and the last stop for unhandled exceptions.

A plain ASGI middleware, not Starlette's BaseHTTPMiddleware, so it covers WebSockets too and
runs the app in the same task (values bound to the log context reach the endpoint).
"""

import logging
import re
import time
import uuid
from typing import Any
from uuid import UUID

import structlog
from fastapi import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import internal_error_response
from app.core.logging_config import elapsed_ms, get_logger

REQUEST_ID_HEADER = "X-Request-ID"
_VALID_REQUEST_ID = re.compile(r"[A-Za-z0-9-]{8,64}")
# A request slower than this is logged as a warning.
SLOW_REQUEST_S = 1.0
# Logged at DEBUG while they succeed: Render polls the first every few seconds, and the client
# log entries are logged on their own lines.
_QUIET_PATHS = frozenset({"/api/health/live", "/api/client-logs"})

access_log = get_logger("app.access")


def bind_user_id(request: Request, user_id: UUID) -> None:
    """Puts the user on the access line and on every later line of this request."""
    request.state.user_id = str(user_id)
    structlog.contextvars.bind_contextvars(user_id=str(user_id))


def _request_id(scope: Scope) -> str:
    for name, value in scope["headers"]:
        if name == b"x-request-id":
            candidate: str = value.decode("latin-1")
            if _VALID_REQUEST_ID.fullmatch(candidate):
                return candidate
            break
    return uuid.uuid4().hex


def _route_template(scope: Scope) -> str | None:
    """The matched route, like /api/cards/{card_id}.

    FastAPI keeps a route that came through include_router relative to its router
    (/cards/{card_id}), so the prefix is read off the front of the actual path.
    """
    route = scope.get("route")
    path_format = getattr(route, "path", None)
    path_regex = getattr(route, "path_regex", None)
    if not isinstance(path_format, str) or not isinstance(path_regex, re.Pattern):
        return None
    match = re.search(path_regex.pattern.removeprefix("^"), scope["path"])
    prefix = scope["path"][: match.start()] if match is not None else ""
    return prefix + path_format


def _is_quiet(path: str) -> bool:
    """Health probes, static files and app pages: everything outside /api and /ws."""
    is_backend = path.startswith(("/api/", "/ws/")) or path in ("/api", "/ws")
    return path in _QUIET_PATHS or not is_backend


def _access_level(path: str, status: int | None, duration_s: float) -> int:
    if status is not None and status >= 500:
        return logging.ERROR
    if status is not None and status < 400 and _is_quiet(path):
        return logging.DEBUG
    if duration_s >= SLOW_REQUEST_S:
        return logging.WARNING
    return logging.INFO


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        request_id = _request_id(scope)
        # httpx's ASGITransport doesn't create the state dict; the handlers below write to it.
        scope.setdefault("state", {})["request_id"] = request_id
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        if scope["type"] == "http":
            await self._http(scope, receive, send, request_id)
        else:
            await self._websocket(scope, receive, send)

    async def _http(self, scope: Scope, receive: Receive, send: Send, request_id: str) -> None:
        started = time.perf_counter()
        status: int | None = None

        async def send_with_request_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = [*message.get("headers", []), (b"x-request-id", request_id.encode())]
                message = {**message, "headers": headers}
            await send(message)

        error: Exception | None = None
        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception as exc:
            # Answered and logged here, once. Nothing is re-raised, so neither Starlette nor
            # uvicorn prints the same traceback again. Cancellation isn't an Exception and
            # passes through.
            error = exc
            scope["state"]["error_code"] = "internal_error"
            if status is None:
                await internal_error_response(request_id)(scope, receive, send_with_request_id)
            # Otherwise the response had already started; uvicorn closes the connection.
        finally:
            self._log_access(scope, status, time.perf_counter() - started, error)

    def _log_access(
        self, scope: Scope, status: int | None, duration_s: float, error: Exception | None
    ) -> None:
        state: dict[str, Any] = scope["state"]
        client = scope.get("client")
        fields: dict[str, Any] = {
            "method": scope["method"],
            # Never the query string: the planned game socket carries the access token in it.
            "path": scope["path"],
            "route": _route_template(scope),
            "status": status,
            "duration_ms": round(duration_s * 1000),
            "user_id": state.get("user_id"),
            "error_code": state.get("error_code"),
            "client_ip": client[0] if client else None,
        }
        fields = {key: value for key, value in fields.items() if value is not None}
        if error is not None:
            access_log.error("http.request", exc_info=error, **fields)
            return
        access_log.log(_access_level(scope["path"], status, duration_s), "http.request", **fields)

    async def _websocket(self, scope: Scope, receive: Receive, send: Send) -> None:
        # Browsers can't send headers on a WebSocket, so the request id is always ours. The
        # socket's own events (ws.connected, ws.closed, ...) come with the game in M6.
        started = time.perf_counter()
        try:
            await self.app(scope, receive, send)
        except Exception as exc:
            access_log.error(
                "ws.unhandled_error",
                path=scope["path"],
                duration_ms=elapsed_ms(started),
                exc_info=exc,
            )
            # Before the handshake this refuses the socket (403); after it, 1011 tells the
            # client the server failed.
            try:
                await send({"type": "websocket.close", "code": 1011})
            except Exception as close_error:  # the socket may already be closed
                access_log.debug("ws.close_failed", error=repr(close_error))
