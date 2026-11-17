import asyncio
import random
from collections.abc import AsyncGenerator, AsyncIterator, Iterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlsplit

import pytest
import structlog
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from httpx_ws.transport import ASGIWebSocketTransport
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import Settings, get_settings
from app.core.deps import get_db, get_s3, get_session_factory
from app.main import create_app
from app.services import room_service
from app.services.live_rooms import LiveRooms
from app.ws.manager import ConnectionManager
from tests.helpers import AuthedUser, FakeS3, make_settings, register_user
from tests.room_helpers import FakeClock

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"
# The room tests empty this Redis database before each test.
TEST_REDIS_DB = 15
TEST_RANDOM_SEED = 6


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


@pytest.fixture(autouse=True)
def _clear_log_context() -> Iterator[None]:
    # httpx's ASGITransport runs the app in the test's own task, so the request id and user id
    # the app binds would otherwise stay on later log lines of the test.
    structlog.contextvars.clear_contextvars()
    yield
    structlog.contextvars.clear_contextvars()


@pytest.fixture
def logs() -> Iterator[list[dict[str, Any]]]:
    """Every structlog entry logged during the test, DEBUG included, with the request's context
    (request id, user id) and the logger name. The level is under `log_level`."""
    processors = [structlog.contextvars.merge_contextvars, structlog.stdlib.add_logger_name]
    with structlog.testing.capture_logs(processors=processors) as entries:
        # The same list, which fills up while the test runs; the entries are plain dicts.
        yield cast(list[dict[str, Any]], entries)


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def fake_s3() -> FakeS3:
    return FakeS3()


@pytest.fixture
def app(db: AsyncSession, settings: Settings, fake_s3: FakeS3) -> FastAPI:
    """The app under test. The test clients don't run its lifespan, so Redis and R2 are never
    touched unless a test sets them up (the room tests do, with `rooms`)."""
    app = create_app()
    # One session for the whole test, and the game sockets run concurrently with requests:
    # this lock keeps two of them from using it at once.
    session_lock = asyncio.Lock()

    @asynccontextmanager
    async def shared_session() -> AsyncGenerator[AsyncSession]:
        async with session_lock:
            # In production each request gets a fresh session. The tests share one, so start
            # every use with an empty identity map; otherwise it would see stale rows from
            # earlier requests (for example a group's card_count).
            db.expunge_all()
            yield db

    async def override_db() -> AsyncIterator[AsyncSession]:
        async with shared_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_session_factory] = lambda: shared_session
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_s3] = lambda: fake_s3
    return app


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


@pytest.fixture
async def redis() -> AsyncIterator[Redis]:
    """The real Redis of the local stack (CI's service), on database 15, emptied first. The URL
    and password come from the real settings, as the test database's do."""
    real = get_settings()
    # redis-py lets the URL's database win over a `db=` argument, so the URL itself changes.
    url = urlsplit(real.redis_url)._replace(path=f"/{TEST_REDIS_DB}").geturl()
    password = real.redis_password.get_secret_value() if real.redis_password else None
    client = Redis.from_url(url, password=password, decode_responses=True)
    if client.connection_pool.connection_kwargs.get("db") != TEST_REDIS_DB:
        raise RuntimeError("The test Redis must be database 15, which the tests empty")
    await client.flushdb()
    try:
        yield client
    finally:
        await client.aclose()


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
async def rooms(
    app: FastAPI, redis: Redis, settings: Settings, clock: FakeClock
) -> AsyncIterator[LiveRooms]:
    """The live rooms, as the lifespan creates them, on the test Redis and a fake clock."""
    connections = ConnectionManager()
    # A fixed seed for the seats and the games' seeds, so a test plays the same way each run.
    rooms = room_service.create_room_runtime(
        redis, settings, clock, connections, random.Random(TEST_RANDOM_SEED)
    )
    app.state.rooms = rooms
    app.state.connections = connections
    try:
        yield rooms
    finally:
        await rooms.aclose()


@pytest.fixture
async def ws_client(app: FastAPI, rooms: LiveRooms) -> AsyncIterator[AsyncClient]:
    """A client for the game socket (and REST). Its transport runs the app in the test's own
    event loop, so the sockets share the test's database session.

    The transport holds an anyio task group, which must be left in the task that entered it;
    pytest-asyncio sets a fixture up and tears it down in different tasks, so one task holds
    the client for the fixture's whole life."""
    entered: asyncio.Future[AsyncClient] = asyncio.get_running_loop().create_future()
    release = asyncio.Event()

    async def hold() -> None:
        transport = ASGIWebSocketTransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            entered.set_result(client)
            await release.wait()

    holder = asyncio.create_task(hold())
    try:
        yield await entered
    finally:
        release.set()
        # Closing the transport ends the open sockets; their handlers clean up first.
        await holder


@pytest.fixture
async def alice(client: AsyncClient) -> AuthedUser:
    return await register_user(client, "alice")


@pytest.fixture
async def bob(client: AsyncClient) -> AuthedUser:
    return await register_user(client, "bob")
