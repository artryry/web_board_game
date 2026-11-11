from typing import Annotated

from fastapi import APIRouter, Depends, Request, status

from app.core.deps import OptionalUserId
from app.core.errors import AppError
from app.schemas.client_log import ClientLogBatch
from app.services import client_log_service
from app.services.client_log_service import ClientLogLimiter

router = APIRouter(prefix="/client-logs", tags=["client-logs"])

MAX_BODY_BYTES = 64 * 1024

_limiter = ClientLogLimiter()


def get_client_log_limiter() -> ClientLogLimiter:
    return _limiter


async def _check_body_size(request: Request) -> None:
    # The browser's sink keeps its batches under this; keepalive requests can't be larger anyway.
    length = request.headers.get("content-length")
    if length is not None and length.isdigit() and int(length) > MAX_BODY_BYTES:
        raise AppError(413, "payload_too_large", f"A batch must be at most {MAX_BODY_BYTES} bytes")


@router.post(
    "",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(_check_body_size)],
)
async def post_client_logs(
    batch: ClientLogBatch,
    request: Request,
    user_id: OptionalUserId,
    limiter: Annotated[ClientLogLimiter, Depends(get_client_log_limiter)],
) -> None:
    """Writes the browser's warnings and errors to the server log as `web.<event>` lines.

    Works with or without a valid access token. Entries over the rate limit are dropped, and
    the answer is 204 either way, so the browser never retries.
    """
    client_ip = request.client.host if request.client is not None else "unknown"
    source = f"user:{user_id}" if user_id is not None else f"ip:{client_ip}"
    client_log_service.record(
        batch.entries,
        source=source,
        user_agent=request.headers.get("user-agent"),
        limiter=limiter,
    )
