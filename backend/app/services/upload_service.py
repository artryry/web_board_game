import re
from uuid import UUID

from app.core.config import Settings
from app.core.errors import AppError
from app.schemas.upload import UploadRequest, UploadTicket
from app.storage.client import ArtKind, S3Client, head_object, make_art_key, presign_put

ART_CONTENT_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}

_UUID_PATTERN = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_EXTENSION_PATTERN = "|".join(ART_CONTENT_TYPES.values())


def _check_size(size: int, settings: Settings) -> None:
    if size > settings.upload_max_bytes:
        raise AppError(
            422, "art_too_large", f"Art must be at most {settings.upload_max_bytes} bytes"
        )


async def request_upload(
    s3: S3Client, settings: Settings, user_id: UUID, kind: ArtKind, data: UploadRequest
) -> UploadTicket:
    """Checks type and size first, then signs a PUT URL for a new key under the user's prefix."""
    extension = ART_CONTENT_TYPES.get(data.content_type)
    if extension is None:
        raise AppError(422, "unsupported_art_type", "Art must be a PNG, JPEG or WebP image")
    _check_size(data.size, settings)

    key = make_art_key(kind, user_id, extension)
    upload_url = await presign_put(
        s3, settings.r2_bucket, key, data.content_type, settings.upload_url_ttl_s
    )
    return UploadTicket(upload_url=upload_url, art_key=key, expires_in=settings.upload_url_ttl_s)


async def verify_art_key(
    s3: S3Client, settings: Settings, user_id: UUID, kind: ArtKind, key: str
) -> None:
    """Accepts a key only if this user uploaded it and the object is an allowed image.

    A presigned PUT can't cap the size on R2, so the stored object is checked here as well.
    """
    pattern = rf"{re.escape(kind)}/{user_id}/{_UUID_PATTERN}\.(?:{_EXTENSION_PATTERN})"
    if re.fullmatch(pattern, key) is None:
        raise AppError(422, "invalid_art_key", "This art key wasn't issued to you for this use")

    info = await head_object(s3, settings.r2_bucket, key)
    if info is None:
        raise AppError(422, "invalid_art_key", "The art hasn't been uploaded yet")
    if info.size > settings.upload_max_bytes:
        raise AppError(
            422, "invalid_art_key", f"The art is larger than {settings.upload_max_bytes} bytes"
        )
    if info.content_type not in ART_CONTENT_TYPES:
        raise AppError(422, "invalid_art_key", "The art isn't a PNG, JPEG or WebP image")
