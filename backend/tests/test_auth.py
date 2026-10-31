from datetime import UTC, datetime, timedelta
from unittest.mock import ANY
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import TokenType, create_access_token, create_refresh_token, decode_token
from app.services import auth_service

USERNAME = "alice"
EMAIL = "alice@example.com"
PASSWORD = "correct-horse"


async def _register(
    client: AsyncClient, username: str = USERNAME, email: str = EMAIL, password: str = PASSWORD
) -> Response:
    return await client.post(
        "/api/auth/register", json={"username": username, "email": email, "password": password}
    )


async def _registered_user_id(client: AsyncClient, settings: Settings) -> UUID:
    response = await _register(client)
    assert response.status_code == 201
    return decode_token(response.json()["access"], TokenType.ACCESS, settings)


def _assert_error(response: Response, status_code: int, code: str) -> None:
    assert response.status_code == status_code
    assert response.json() == {"detail": {"code": code, "message": ANY}}
    if status_code == 401:
        assert response.headers["www-authenticate"] == "Bearer"


def _assert_token_pair(response: Response, settings: Settings) -> UUID:
    body = response.json()
    assert set(body) == {"access", "refresh"}
    user_id = decode_token(body["access"], TokenType.ACCESS, settings)
    assert decode_token(body["refresh"], TokenType.REFRESH, settings) == user_id
    return user_id


# --- register ---


async def test_register_returns_token_pair(client: AsyncClient, settings: Settings) -> None:
    response = await _register(client)

    assert response.status_code == 201
    _assert_token_pair(response, settings)


async def test_register_duplicate_username_ignores_case(client: AsyncClient) -> None:
    await _register(client, username="Alice")

    response = await _register(client, username="alice", email="other@example.com")

    _assert_error(response, 409, "username_taken")


async def test_register_duplicate_email_ignores_case(client: AsyncClient) -> None:
    await _register(client)

    response = await _register(client, username="bob", email="Alice@Example.COM")

    _assert_error(response, 409, "email_taken")


@pytest.mark.parametrize(
    "overrides",
    [
        {"username": "ab"},
        {"username": "a" * 33},
        {"username": "bad name!"},
        {"email": "not-an-email"},
        {"password": "short"},
        {"password": "x" * 129},
    ],
)
async def test_register_rejects_invalid_input(
    client: AsyncClient, overrides: dict[str, str]
) -> None:
    payload = {"username": USERNAME, "email": EMAIL, "password": PASSWORD} | overrides

    response = await client.post("/api/auth/register", json=payload)

    assert response.status_code == 422


async def test_register_race_on_unique_index_returns_409(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _register(client)
    real_check = auth_service._ensure_available
    calls = 0

    # Skip the first availability check, as if the other registration committed just after it.
    async def check_after_first_call(db: AsyncSession, username: str, email: str) -> None:
        nonlocal calls
        calls += 1
        if calls > 1:
            await real_check(db, username, email)

    monkeypatch.setattr(auth_service, "_ensure_available", check_after_first_call)

    response = await _register(client, email="other@example.com")

    _assert_error(response, 409, "username_taken")
    assert calls == 2


# --- login ---


async def test_login_returns_token_pair(client: AsyncClient, settings: Settings) -> None:
    user_id = await _registered_user_id(client, settings)

    response = await client.post(
        "/api/auth/login", json={"email": "ALICE@example.com", "password": PASSWORD}
    )

    assert response.status_code == 200
    assert _assert_token_pair(response, settings) == user_id


async def test_login_wrong_password_and_unknown_email_look_the_same(client: AsyncClient) -> None:
    await _register(client)

    wrong_password = await client.post(
        "/api/auth/login", json={"email": EMAIL, "password": "wrong-password"}
    )
    unknown_email = await client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": PASSWORD}
    )

    _assert_error(wrong_password, 401, "invalid_credentials")
    _assert_error(unknown_email, 401, "invalid_credentials")
    assert wrong_password.json() == unknown_email.json()


# --- refresh ---


async def test_refresh_returns_new_token_pair(client: AsyncClient, settings: Settings) -> None:
    registered = await _register(client)

    response = await client.post(
        "/api/auth/refresh", json={"refresh": registered.json()["refresh"]}
    )

    assert response.status_code == 200
    assert _assert_token_pair(response, settings) == _assert_token_pair(registered, settings)


async def test_refresh_rejects_access_token(client: AsyncClient) -> None:
    registered = await _register(client)

    response = await client.post("/api/auth/refresh", json={"refresh": registered.json()["access"]})

    _assert_error(response, 401, "token_wrong_type")


async def test_refresh_rejects_expired_token(client: AsyncClient, settings: Settings) -> None:
    user_id = await _registered_user_id(client, settings)
    issued = datetime.now(UTC) - timedelta(days=settings.refresh_token_ttl_days + 1)
    token = create_refresh_token(user_id, settings, now=issued)

    response = await client.post("/api/auth/refresh", json={"refresh": token})

    _assert_error(response, 401, "token_expired")


async def test_refresh_rejects_garbage(client: AsyncClient) -> None:
    response = await client.post("/api/auth/refresh", json={"refresh": "not-a-jwt"})

    _assert_error(response, 401, "token_invalid")


async def test_refresh_rejects_token_of_unknown_user(
    client: AsyncClient, settings: Settings
) -> None:
    token = create_refresh_token(uuid4(), settings)

    response = await client.post("/api/auth/refresh", json={"refresh": token})

    _assert_error(response, 401, "token_invalid")


# --- me ---


async def test_me_returns_current_user(client: AsyncClient, settings: Settings) -> None:
    registered = await _register(client, username="Alice", email="Alice@Example.com")
    access = registered.json()["access"]

    response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {access}"})

    assert response.status_code == 200
    assert response.json() == {
        "id": str(decode_token(access, TokenType.ACCESS, settings)),
        "username": "Alice",
        "email": "alice@example.com",
        "created_at": ANY,
    }


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Basic YWxpY2U6cGFzc3dvcmQ="}])
async def test_me_without_bearer_token(client: AsyncClient, headers: dict[str, str]) -> None:
    response = await client.get("/api/auth/me", headers=headers)

    _assert_error(response, 401, "not_authenticated")


async def test_me_rejects_bad_token(client: AsyncClient) -> None:
    response = await client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-jwt"})

    _assert_error(response, 401, "token_invalid")


async def test_me_rejects_expired_token(client: AsyncClient, settings: Settings) -> None:
    user_id = await _registered_user_id(client, settings)
    issued = datetime.now(UTC) - timedelta(minutes=settings.access_token_ttl_min + 1)
    token = create_access_token(user_id, settings, now=issued)

    response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    _assert_error(response, 401, "token_expired")


async def test_me_rejects_refresh_token(client: AsyncClient) -> None:
    refresh = (await _register(client)).json()["refresh"]

    response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {refresh}"})

    _assert_error(response, 401, "token_wrong_type")
