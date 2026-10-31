from collections.abc import Mapping
from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    """An expected error that maps to an HTTP response with a machine-readable code."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers


class UnauthorizedError(AppError):
    # RFC 9110 requires a WWW-Authenticate header on every 401 response.
    def __init__(self, code: str, message: str) -> None:
        super().__init__(401, code, message, headers={"WWW-Authenticate": "Bearer"})


def _error_response(
    status_code: int, code: str, message: str, headers: Mapping[str, str] | None
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"detail": {"code": code, "message": message}},
        headers=headers,
    )


async def _handle_app_error(_request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    return _error_response(exc.status_code, exc.code, exc.message, exc.headers)


async def _handle_http_exception(_request: Request, exc: Exception) -> JSONResponse:
    # Framework errors (unknown route, wrong method, ...) get the same body shape as ours.
    assert isinstance(exc, StarletteHTTPException)
    phrase = HTTPStatus(exc.status_code).phrase
    code = phrase.lower().replace(" ", "_").replace("-", "_")
    message = exc.detail if isinstance(exc.detail, str) else phrase
    return _error_response(exc.status_code, code, message, exc.headers)


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _handle_app_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)
