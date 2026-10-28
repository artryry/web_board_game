from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

import aioboto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import Settings

# aiobotocore clients are generated at runtime and ship no type stubs.
S3Client = Any

_MISSING_BUCKET_CODES = {"404", "403", "NoSuchBucket"}

# R2 ignores AWS regions ("auto"), and Cloudflare recommends sending checksums only when an
# operation requires them, since newer botocore adds them by default.
_R2_CONFIG = Config(
    region_name="auto",
    request_checksum_calculation="when_required",
    response_checksum_validation="when_required",
)


@asynccontextmanager
async def create_s3_client(settings: Settings) -> AsyncGenerator[S3Client]:
    async with aioboto3.Session().client(
        "s3",
        endpoint_url=str(settings.r2_endpoint),
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key.get_secret_value(),
        config=_R2_CONFIG,
    ) as s3:
        yield s3


async def bucket_exists(s3: S3Client, bucket: str) -> bool:
    try:
        await s3.head_bucket(Bucket=bucket)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in _MISSING_BUCKET_CODES:
            return False
        raise
    return True
