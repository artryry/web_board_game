from collections.abc import AsyncGenerator
from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from app.api.router import api_router
from app.core.config import get_settings
from app.core.db import create_engine, create_session_factory
from app.storage.client import create_s3_client


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    settings = get_settings()
    async with AsyncExitStack() as stack:
        engine = create_engine(settings)
        stack.push_async_callback(engine.dispose)
        app.state.session_factory = create_session_factory(engine)

        redis = Redis.from_url(
            settings.redis_url,
            password=settings.redis_password.get_secret_value(),
            decode_responses=True,
        )
        stack.push_async_callback(redis.aclose)
        app.state.redis = redis

        app.state.s3 = await stack.enter_async_context(create_s3_client(settings))

        yield


def create_app() -> FastAPI:
    app = FastAPI(title="Card Table API", lifespan=lifespan)
    app.include_router(api_router)
    return app


app = create_app()
