from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.core.errors import UnauthorizedError
from app.core.security import (
    TokenType,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from tests.helpers import make_settings

SETTINGS = make_settings()

TokenFactory = Callable[..., str]


def _decode_error_code(token: str, expected_type: TokenType, settings: Settings = SETTINGS) -> str:
    with pytest.raises(UnauthorizedError) as exc_info:
        decode_token(token, expected_type, settings)
    assert exc_info.value.status_code == 401
    return exc_info.value.code


def test_hash_round_trip() -> None:
    password_hash = hash_password("correct horse")

    assert password_hash != "correct horse"
    assert verify_password("correct horse", password_hash)
    assert not verify_password("wrong horse", password_hash)


def test_same_password_gets_a_different_hash_each_time() -> None:
    assert hash_password("correct horse") != hash_password("correct horse")


def test_verify_without_a_hash_is_false() -> None:
    assert not verify_password("correct horse", None)


@pytest.mark.parametrize(
    ("create", "token_type"),
    [(create_access_token, TokenType.ACCESS), (create_refresh_token, TokenType.REFRESH)],
)
def test_token_round_trip(create: TokenFactory, token_type: TokenType) -> None:
    user_id = uuid4()

    assert decode_token(create(user_id, SETTINGS), token_type, SETTINGS) == user_id


@pytest.mark.parametrize(
    ("create", "expected_type"),
    [(create_access_token, TokenType.REFRESH), (create_refresh_token, TokenType.ACCESS)],
)
def test_token_of_wrong_type_is_rejected(create: TokenFactory, expected_type: TokenType) -> None:
    token = create(uuid4(), SETTINGS)

    assert _decode_error_code(token, expected_type) == "token_wrong_type"


def test_expired_token_is_rejected() -> None:
    issued = datetime.now(UTC) - timedelta(minutes=SETTINGS.access_token_ttl_min + 1)
    token = create_access_token(uuid4(), SETTINGS, now=issued)

    assert _decode_error_code(token, TokenType.ACCESS) == "token_expired"


def test_garbage_token_is_rejected() -> None:
    assert _decode_error_code("not-a-jwt", TokenType.ACCESS) == "token_invalid"


def test_token_signed_with_another_secret_is_rejected() -> None:
    other = SETTINGS.model_copy(
        update={"jwt_secret": SecretStr("another-secret-that-is-at-least-32-chars")}
    )
    token = create_access_token(uuid4(), other)

    assert _decode_error_code(token, TokenType.ACCESS) == "token_invalid"


def _sign(claims: dict[str, object]) -> str:
    return jwt.encode(claims, SETTINGS.jwt_secret.get_secret_value(), algorithm="HS256")


def test_token_missing_a_claim_is_rejected() -> None:
    token = _sign({"sub": str(uuid4()), "type": "access", "iat": datetime.now(UTC)})

    assert _decode_error_code(token, TokenType.ACCESS) == "token_invalid"


def test_token_with_non_uuid_subject_is_rejected() -> None:
    now = datetime.now(UTC)
    token = _sign({"sub": "alice", "type": "access", "iat": now, "exp": now + timedelta(minutes=1)})

    assert _decode_error_code(token, TokenType.ACCESS) == "token_invalid"
