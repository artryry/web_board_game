from collections.abc import AsyncIterator
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import UnauthorizedError
from app.core.logging_config import get_logger
from app.core.middleware import bind_user_id
from app.core.security import TokenType, decode_token
from app.models.user import User
from app.schemas.common import DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, PageParams
from app.services import auth_service
from app.storage.client import S3Client

# auto_error=False: a missing or non-Bearer header gets our error body, not FastAPI's.
_bearer = HTTPBearer(auto_error=False)

log = get_logger(__name__)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.session_factory() as session:
        yield session


def get_redis(request: Request) -> Redis:
    redis: Redis = request.app.state.redis
    return redis


def get_s3(request: Request) -> S3Client:
    return request.app.state.s3


# Async on purpose: sync dependencies run in a thread with a copy of the log context, so the
# user id bound here would never reach the endpoint's log lines.
async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    if credentials is None:
        raise UnauthorizedError("not_authenticated", "Missing bearer token")
    user = await auth_service.user_from_token(
        db, credentials.credentials, TokenType.ACCESS, settings
    )
    bind_user_id(request, user.id)
    return user


async def get_optional_user_id(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> UUID | None:
    """The user of a valid access token, or None: never a 401.

    It only decodes the token, with no database query, so a caller that logs every few seconds
    doesn't wake the database.
    """
    if credentials is None:
        return None
    try:
        user_id = decode_token(credentials.credentials, TokenType.ACCESS, settings)
    except UnauthorizedError as exc:
        # An expired token is normal here: the browser sends its logs without refreshing.
        log.debug("auth.optional_token_ignored", code=exc.code)
        return None
    bind_user_id(request, user_id)
    return user_id


def get_page_params(
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_LIMIT)] = DEFAULT_PAGE_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> PageParams:
    return PageParams(limit=limit, offset=offset)


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUserId = Annotated[UUID | None, Depends(get_optional_user_id)]
Db = Annotated[AsyncSession, Depends(get_db)]
S3 = Annotated[S3Client, Depends(get_s3)]
AppSettings = Annotated[Settings, Depends(get_settings)]
Pagination = Annotated[PageParams, Depends(get_page_params)]
