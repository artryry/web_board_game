from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.deps import get_db, get_redis, get_s3
from app.schemas.health import HealthResponse, LivenessResponse
from app.services.health_service import check_health
from app.storage.client import S3Client

router = APIRouter(tags=["health"])


@router.get("/health/live", response_model=LivenessResponse)
async def liveness() -> LivenessResponse:
    """Answers as long as the process serves requests, without touching any service.

    The hosting platform polls this every few seconds. Polling `/health` instead would spend
    Redis commands and R2 operations on every probe and keep the database from scaling to zero.
    """
    return LivenessResponse(status="ok")


@router.get("/health", response_model=HealthResponse)
async def health(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
    s3: Annotated[S3Client, Depends(get_s3)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> HealthResponse:
    result = await check_health(db, redis, s3, settings.r2_bucket, settings.health_check_timeout_s)
    if result.status != "ok":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return result
