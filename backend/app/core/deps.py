from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import UnauthorizedError
from app.core.security import TokenType
from app.models.user import User
from app.services import auth_service
from app.storage.client import S3Client

# auto_error=False: a missing or non-Bearer header gets our error body, not FastAPI's.
_bearer = HTTPBearer(auto_error=False)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.session_factory() as session:
        yield session


def get_redis(request: Request) -> Redis:
    redis: Redis = request.app.state.redis
    return redis


def get_s3(request: Request) -> S3Client:
    return request.app.state.s3


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    if credentials is None:
        raise UnauthorizedError("not_authenticated", "Missing bearer token")
    return await auth_service.user_from_token(
        db, credentials.credentials, TokenType.ACCESS, settings
    )


CurrentUser = Annotated[User, Depends(get_current_user)]
