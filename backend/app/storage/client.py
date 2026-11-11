from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

import aioboto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import Settings

# aiobotocore clients are generated at runtime and ship no type stubs.
S3Client = Any

_MISSING_BUCKET_CODES = {"404", "403", "NoSuchBucket"}
_MISSING_OBJECT_CODES = {"404", "NoSuchKey", "NotFound"}

# R2 ignores AWS regions ("auto") and only accepts SigV4, also for presigned URLs. Cloudflare
# recommends sending checksums only when an operation requires them, since newer botocore adds
# them by default.
_R2_CONFIG = Config(
    region_name="auto",
    signature_version="s3v4",
    request_checksum_calculation="when_required",
    response_checksum_validation="when_required",
)


class ArtKind(StrEnum):
    """The top-level prefix of an art object's key."""

    CARD = "card-art"
    ORIGIN = "origin-art"


@dataclass(frozen=True)
class ObjectInfo:
    size: int
    content_type: str | None


@dataclass(frozen=True)
class StoredObject:
    key: str
    last_modified: datetime


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


def make_art_key(kind: ArtKind, user_id: UUID, extension: str) -> str:
    """`{kind}/{user_id}/{uuid}.{ext}`: the user prefix is how a save checks who uploaded it."""
    return f"{kind}/{user_id}/{uuid4()}.{extension}"


async def presign_put(
    s3: S3Client, bucket: str, key: str, content_type: str, expires_in: int
) -> str:
    """A presigned PUT URL. Content-Type is signed, so the upload must send exactly that type."""
    url: str = await s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=expires_in,
    )
    return url


async def head_object(s3: S3Client, bucket: str, key: str) -> ObjectInfo | None:
    """Size and type of an object, or None if it doesn't exist."""
    try:
        response = await s3.head_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in _MISSING_OBJECT_CODES:
            return None
        raise
    return ObjectInfo(size=int(response["ContentLength"]), content_type=response.get("ContentType"))


async def list_objects(s3: S3Client, bucket: str, prefix: str) -> AsyncIterator[StoredObject]:
    """Every object under `prefix`, fetched a page (up to 1000 keys) at a time."""
    params = {"Bucket": bucket, "Prefix": prefix}
    while True:
        response = await s3.list_objects_v2(**params)
        for item in response.get("Contents", []):
            yield StoredObject(key=item["Key"], last_modified=item["LastModified"])
        token = response.get("NextContinuationToken")
        if not response.get("IsTruncated") or token is None:
            return
        params["ContinuationToken"] = token


async def delete_object(s3: S3Client, bucket: str, key: str) -> None:
    """Deletes one object. A missing key is not an error (S3 answers 204 either way).

    One request per key: the multi-delete call needs a request checksum, and the few objects a
    cleanup removes don't need it.
    """
    await s3.delete_object(Bucket=bucket, Key=key)


def public_url(base_url: object, key: str) -> str:
    # HttpUrl renders a bare domain with a trailing "/", so join without doubling it.
    return f"{str(base_url).rstrip('/')}/{key}"
