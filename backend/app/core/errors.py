from collections.abc import Mapping
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    """An expected error that maps to an HTTP response with a machine-readable code.

    `extra` adds fields to the error body next to `code` and `message`, for example the cards
    that still use an origin.
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        headers: dict[str, str] | None = None,
        extra: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers
        self.extra = extra


class UnauthorizedError(AppError):
    # RFC 9110 requires a WWW-Authenticate header on every 401 response.
    def __init__(self, code: str, message: str) -> None:
        super().__init__(401, code, message, headers={"WWW-Authenticate": "Bearer"})


def _error_response(
    status_code: int,
    code: str,
    message: str,
    headers: Mapping[str, str] | None,
    extra: Mapping[str, Any] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"detail": {**(extra or {}), "code": code, "message": message}},
        headers=headers,
    )


def internal_error_response(request_id: str) -> JSONResponse:
    """The answer to an unhandled exception. The request id finds its log line."""
    return _error_response(
        500, "internal_error", "Something went wrong.", None, {"request_id": request_id}
    )


# The request middleware puts the code on the request's access line.
def _note_error_code(request: Request, code: str) -> None:
    request.state.error_code = code


async def _handle_app_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    _note_error_code(request, exc.code)
    return _error_response(exc.status_code, exc.code, exc.message, exc.headers, exc.extra)


async def _handle_http_exception(request: Request, exc: Exception) -> JSONResponse:
    # Framework errors (unknown route, wrong method, ...) get the same body shape as ours.
    assert isinstance(exc, StarletteHTTPException)
    phrase = HTTPStatus(exc.status_code).phrase
    code = phrase.lower().replace(" ", "_").replace("-", "_")
    message = exc.detail if isinstance(exc.detail, str) else phrase
    _note_error_code(request, code)
    return _error_response(exc.status_code, code, message, exc.headers)


async def _handle_validation_error(request: Request, exc: Exception) -> JSONResponse:
    # FastAPI's own 422 body stays as it is (backend_plan §8); only the code is noted.
    assert isinstance(exc, RequestValidationError)
    _note_error_code(request, "validation_error")
    return await request_validation_exception_handler(request, exc)


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _handle_app_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
