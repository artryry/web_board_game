import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import Settings, get_settings
from app.core.deps import get_db, get_s3
from app.main import create_app
from tests.helpers import AuthedUser, FakeS3, make_settings, register_user

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


async def _create_database_if_missing(url: URL) -> None:
    # CREATE DATABASE can't run inside a transaction, so connect to the maintenance DB with
    # autocommit.
    engine = create_async_engine(
        url.set(database="postgres"), isolation_level="AUTOCOMMIT", poolclass=NullPool
    )
    try:
        async with engine.connect() as conn:
            exists = await conn.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": url.database}
            )
            if not exists:
                await conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    finally:
        await engine.dispose()


# The DB fixtures below are sync: Alembic's async env.py calls asyncio.run(), which can't run
# inside pytest-asyncio's event loop.
@pytest.fixture(scope="session")
def test_database_url() -> URL:
    """`<POSTGRES_DB>_test` in the same Postgres container, created if missing."""
    url = make_url(get_settings().database_url.get_secret_value())
    url = url.set(database=f"{url.database}_test")
    asyncio.run(_create_database_if_missing(url))
    return url


@pytest.fixture(scope="session")
def alembic_cfg(test_database_url: URL) -> Config:
    cfg = Config(ALEMBIC_INI)
    rendered_url = test_database_url.render_as_string(hide_password=False)
    cfg.set_main_option("sqlalchemy.url", rendered_url.replace("%", "%%"))
    cfg.attributes["configure_logger"] = False
    return cfg


@pytest.fixture(scope="session")
def migrated_database(test_database_url: URL, alembic_cfg: Config) -> URL:
    command.upgrade(alembic_cfg, "head")
    return test_database_url


@pytest.fixture
async def db(migrated_database: URL) -> AsyncIterator[AsyncSession]:
    """A session inside a transaction that is rolled back after the test.

    In "create_savepoint" mode the code under test can commit and roll back freely: those only
    touch savepoints, and the outer rollback still discards everything. The engine is per test
    because pytest-asyncio gives each test its own event loop, and asyncpg connections can't
    move between loops.
    """
    engine = create_async_engine(migrated_database, poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            await conn.begin()
            session = AsyncSession(
                bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
            )
            try:
                yield session
            finally:
                await session.close()
                await conn.rollback()
    finally:
        await engine.dispose()


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def fake_s3() -> FakeS3:
    return FakeS3()


@pytest.fixture
async def client(
    db: AsyncSession, settings: Settings, fake_s3: FakeS3
) -> AsyncIterator[AsyncClient]:
    # ASGITransport doesn't run the lifespan, so Redis and R2 are never touched.
    app = create_app()

    async def override_db() -> AsyncIterator[AsyncSession]:
        # In production each request gets a fresh session. The tests share one, so start every
        # request with an empty identity map; otherwise it would see stale rows from earlier
        # requests (for example a group's card_count).
        db.expunge_all()
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_s3] = lambda: fake_s3
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


@pytest.fixture
async def alice(client: AsyncClient) -> AuthedUser:
    return await register_user(client, "alice")


@pytest.fixture
async def bob(client: AsyncClient) -> AuthedUser:
    return await register_user(client, "bob")
