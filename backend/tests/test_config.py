from typing import Any

import pytest
from pydantic import ValidationError

from app.core.config import Settings, to_asyncpg_url
from tests.helpers import make_settings


def _settings(**overrides: Any) -> Settings:
    return Settings(**(make_settings().model_dump() | overrides))


def test_neon_url_is_converted_for_asyncpg() -> None:
    neon = (
        "postgresql://app:p%40ss@ep-cool-1.eu-central-1.aws.neon.tech/cardtable"
        "?sslmode=require&channel_binding=require"
    )

    assert to_asyncpg_url(neon) == (
        "postgresql+asyncpg://app:p%40ss@ep-cool-1.eu-central-1.aws.neon.tech/cardtable?ssl=require"
    )


def test_postgres_scheme_gets_the_asyncpg_driver() -> None:
    assert to_asyncpg_url("postgres://app:pw@db.example.com/cardtable") == (
        "postgresql+asyncpg://app:pw@db.example.com/cardtable"
    )


def test_local_asyncpg_url_is_unchanged() -> None:
    local = "postgresql+asyncpg://cardtable:change-me@127.0.0.1:5432/cardtable"

    assert to_asyncpg_url(local) == local


def test_explicit_ssl_wins_over_sslmode() -> None:
    url = "postgresql+asyncpg://app:pw@db.example.com/cardtable?ssl=verify-full&sslmode=require"

    assert (
        to_asyncpg_url(url)
        == "postgresql+asyncpg://app:pw@db.example.com/cardtable?ssl=verify-full"
    )


def test_settings_convert_database_url() -> None:
    settings = _settings(
        database_url="postgresql://app:pw@db.example.com/cardtable?sslmode=require"
    )

    assert settings.database_url.get_secret_value() == (
        "postgresql+asyncpg://app:pw@db.example.com/cardtable?ssl=require"
    )


@pytest.mark.parametrize("bad_url", ["not a url", "postgresql://app:hunter2@db:no-port/cardtable"])
def test_invalid_database_url_error_hides_the_url(bad_url: str) -> None:
    with pytest.raises(ValidationError) as excinfo:
        _settings(database_url=bad_url)

    assert "database_url" in str(excinfo.value)
    assert "hunter2" not in str(excinfo.value)
    assert bad_url not in str(excinfo.value)


def test_redis_password_is_optional() -> None:
    settings = _settings(
        redis_url="rediss://default:token@eu1.upstash.io:6379", redis_password=None
    )

    assert settings.redis_password is None
