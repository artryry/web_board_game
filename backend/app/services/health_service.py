import asyncio
import logging
from collections.abc import Awaitable

from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.health import HealthResponse
from app.storage.client import S3Client, bucket_exists

logger = logging.getLogger(__name__)


async def _probe(name: str, check: Awaitable[object], timeout_s: float) -> bool:
    try:
        result = await asyncio.wait_for(check, timeout_s)
    except Exception:
        logger.exception("Health check failed: %s", name)
        return False
    if result is False:
        logger.warning("Health check failed: %s returned False", name)
        return False
    return True


async def _ping_postgres(db: AsyncSession) -> None:
    await db.execute(text("SELECT 1"))


async def check_health(
    db: AsyncSession, redis: Redis, s3: S3Client, bucket: str, timeout_s: float
) -> HealthResponse:
    postgres_ok, redis_ok, storage_ok = await asyncio.gather(
        _probe("postgres", _ping_postgres(db), timeout_s),
        _probe("redis", redis.ping(), timeout_s),
        _probe("storage", bucket_exists(s3, bucket), timeout_s),
    )
    healthy = postgres_ok and redis_ok and storage_ok
    return HealthResponse(
        status="ok" if healthy else "degraded",
        postgres=postgres_ok,
        redis=redis_ok,
        storage=storage_ok,
    )
