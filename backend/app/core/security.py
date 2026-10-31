from datetime import UTC, datetime, timedelta
from enum import StrEnum
from uuid import UUID

import jwt
from pwdlib import PasswordHash

from app.core.config import Settings
from app.core.errors import UnauthorizedError

_hasher = PasswordHash.recommended()

_REQUIRED_CLAIMS = ["sub", "type", "iat", "exp"]


class TokenType(StrEnum):
    ACCESS = "access"
    REFRESH = "refresh"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if password_hash is None:
        return False
    return _hasher.verify(password, password_hash)


def _create_token(
    user_id: UUID, token_type: TokenType, ttl: timedelta, settings: Settings, now: datetime | None
) -> str:
    issued_at = now or datetime.now(UTC)
    claims = {
        "sub": str(user_id),
        "type": token_type.value,
        "iat": issued_at,
        "exp": issued_at + ttl,
    }
    return jwt.encode(
        claims, settings.jwt_secret.get_secret_value(), algorithm=settings.jwt_algorithm
    )


def create_access_token(user_id: UUID, settings: Settings, *, now: datetime | None = None) -> str:
    ttl = timedelta(minutes=settings.access_token_ttl_min)
    return _create_token(user_id, TokenType.ACCESS, ttl, settings, now)


def create_refresh_token(user_id: UUID, settings: Settings, *, now: datetime | None = None) -> str:
    ttl = timedelta(days=settings.refresh_token_ttl_days)
    return _create_token(user_id, TokenType.REFRESH, ttl, settings, now)


def decode_token(token: str, expected_type: TokenType, settings: Settings) -> UUID:
    """Return the user id from a valid token of the expected type, or raise a 401."""
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            options={"require": _REQUIRED_CLAIMS},
        )
    except jwt.ExpiredSignatureError:
        raise UnauthorizedError("token_expired", "Token has expired") from None
    except jwt.InvalidTokenError:
        raise UnauthorizedError("token_invalid", "Token is invalid") from None

    if claims["type"] != expected_type:
        raise UnauthorizedError("token_wrong_type", f"Expected a token of type '{expected_type}'")
    try:
        return UUID(claims["sub"])
    except ValueError:
        raise UnauthorizedError("token_invalid", "Token is invalid") from None
