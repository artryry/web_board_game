import asyncio
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError, UnauthorizedError
from app.core.logging_config import get_logger
from app.core.security import (
    TokenType,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest

log = get_logger(__name__)


@dataclass(frozen=True)
class TokenPair:
    """Both tokens of a session. The router splits them: the access token goes in the body and
    the refresh token in its cookie."""

    access: str
    refresh: str


def _normalize_email(email: str) -> str:
    return email.lower()


def _issue_tokens(user_id: UUID, settings: Settings) -> TokenPair:
    return TokenPair(
        access=create_access_token(user_id, settings),
        refresh=create_refresh_token(user_id, settings),
    )


async def _ensure_available(db: AsyncSession, username: str, email: str) -> None:
    username_taken = await db.scalar(
        select(User.id).where(func.lower(User.username) == username.lower())
    )
    if username_taken is not None:
        raise AppError(409, "username_taken", "This username is already taken")
    email_taken = await db.scalar(select(User.id).where(func.lower(User.email) == email))
    if email_taken is not None:
        raise AppError(409, "email_taken", "An account with this email already exists")


async def register(db: AsyncSession, data: RegisterRequest, settings: Settings) -> TokenPair:
    email = _normalize_email(data.email)
    await _ensure_available(db, data.username, email)

    # Argon2 is CPU-heavy (~50 ms); a thread keeps the event loop free for other requests.
    password_hash = await asyncio.to_thread(hash_password, data.password)
    user = User(username=data.username, email=email, password_hash=password_hash)
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        # Another registration with the same username or email committed after our check.
        await db.rollback()
        await _ensure_available(db, data.username, email)
        raise
    log.info("auth.registered", user_id=user.id)
    return _issue_tokens(user.id, settings)


async def authenticate(db: AsyncSession, data: LoginRequest, settings: Settings) -> TokenPair:
    email = _normalize_email(data.email)
    user = await db.scalar(select(User).where(func.lower(User.email) == email))
    password_hash = user.password_hash if user is not None else None
    password_ok = await asyncio.to_thread(verify_password, data.password, password_hash)
    if user is None or not password_ok:
        raise UnauthorizedError("invalid_credentials", "Wrong email or password")
    log.info("auth.logged_in", user_id=user.id)
    return _issue_tokens(user.id, settings)


async def user_from_token(
    db: AsyncSession, token: str, expected_type: TokenType, settings: Settings
) -> User:
    user_id = decode_token(token, expected_type, settings)
    user = await db.get(User, user_id)
    if user is None:
        raise UnauthorizedError("token_invalid", "Token is invalid")
    return user


async def refresh(db: AsyncSession, refresh_token: str, settings: Settings) -> TokenPair:
    user = await user_from_token(db, refresh_token, TokenType.REFRESH, settings)
    return _issue_tokens(user.id, settings)
