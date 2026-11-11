import asyncio
import contextlib
import contextvars
from collections.abc import AsyncGenerator
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from redis.asyncio import Redis

from app.api.router import api_router
from app.core.config import get_settings
from app.core.db import create_engine, create_session_factory
from app.core.errors import register_error_handlers
from app.core.logging_config import configure_logging, get_logger
from app.core.middleware import RequestContextMiddleware
from app.frontend import mount_frontend
from app.services import art_cleanup_service
from app.storage.client import create_s3_client

log = get_logger(__name__)


async def _cancel(task: asyncio.Task[None]) -> None:
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    settings = get_settings()
    async with AsyncExitStack() as stack:
        engine = create_engine(settings)
        stack.push_async_callback(engine.dispose)
        app.state.session_factory = create_session_factory(engine)

        password = settings.redis_password
        redis = Redis.from_url(
            settings.redis_url,
            password=password.get_secret_value() if password is not None else None,
            decode_responses=True,
            # Hosted Redis can drop connections that sit idle; one unused for this many seconds
            # is pinged before it is reused, instead of failing the first command.
            health_check_interval=30,
        )
        stack.push_async_callback(redis.aclose)
        app.state.redis = redis

        app.state.s3 = await stack.enter_async_context(create_s3_client(settings))

        if settings.art_sweep_enabled:
            # An empty context, so the task's lines never carry another request's ids.
            sweep_task = asyncio.create_task(
                art_cleanup_service.sweep_forever(
                    app.state.session_factory, redis, app.state.s3, settings
                ),
                name="art_sweep",
                context=contextvars.Context(),
            )
            # Pushed last, so it is cancelled before the clients it uses are closed.
            stack.push_async_callback(_cancel, sweep_task)

        log.info(
            "app.started",
            log_level=settings.log_level,
            log_format=settings.log_format,
            commit=settings.render_git_commit,
            art_sweep=settings.art_sweep_enabled,
        )
        yield
        log.info("app.stopped")


def create_app(frontend_dist_dir: Path | None = None) -> FastAPI:
    # The schema and docs live under /api so nginx proxies them like every other request.
    app = FastAPI(
        title="Card Table API",
        lifespan=lifespan,
        openapi_url="/api/openapi.json",
        docs_url="/api/docs",
        redoc_url=None,
    )
    register_error_handlers(app)
    app.add_middleware(RequestContextMiddleware)
    app.include_router(api_router)
    # After the API routes, so the frontend's catch-all never shadows them.
    if frontend_dist_dir is not None:
        mount_frontend(app, frontend_dist_dir)
    return app


# Once per process, before the app exists (see configure_logging).
configure_logging(get_settings())
app = create_app(get_settings().frontend_dist_dir)
