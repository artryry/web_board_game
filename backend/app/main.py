from collections.abc import AsyncGenerator
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from redis.asyncio import Redis

from app.api.router import api_router
from app.core.config import get_settings
from app.core.db import create_engine, create_session_factory
from app.core.errors import register_error_handlers
from app.frontend import mount_frontend
from app.storage.client import create_s3_client


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

        yield


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
    app.include_router(api_router)
    # After the API routes, so the frontend's catch-all never shadows them.
    if frontend_dist_dir is not None:
        mount_frontend(app, frontend_dist_dir)
    return app


app = create_app(get_settings().frontend_dist_dir)
