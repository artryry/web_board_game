import asyncio
from collections.abc import Awaitable

from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging_config import get_logger
from app.schemas.health import HealthResponse
from app.storage.client import S3Client, bucket_exists

log = get_logger(__name__)


async def _probe(name: str, check: Awaitable[object], timeout_s: float) -> bool:
    try:
        result = await asyncio.wait_for(check, timeout_s)
    except Exception:
        log.warning("health.check_failed", check=name, exc_info=True)
        return False
    if result is False:
        log.warning("health.check_failed", check=name, reason="returned_false")
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
