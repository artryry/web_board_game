import re
import time
from uuid import UUID

from app.core.config import Settings
from app.core.errors import AppError
from app.core.logging_config import elapsed_ms, get_logger
from app.schemas.upload import UploadRequest, UploadTicket
from app.storage.client import ArtKind, S3Client, head_object, make_art_key, presign_put

log = get_logger(__name__)

ART_CONTENT_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}

_UUID_PATTERN = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_EXTENSION_PATTERN = "|".join(ART_CONTENT_TYPES.values())


def _art_key_pattern(kind: str, user_id: str) -> str:
    """The shape make_art_key gives, `{kind}/{user_id}/{uuid}.{ext}`; both parts are regexes."""
    return rf"{kind}/{user_id}/{_UUID_PATTERN}\.(?:{_EXTENSION_PATTERN})"


_ANY_ART_KEY = re.compile(
    _art_key_pattern(f"(?:{'|'.join(re.escape(kind) for kind in ArtKind)})", _UUID_PATTERN)
)


def is_art_key(key: str) -> bool:
    """Whether `key` has the shape of an art key this service hands out, for any user or kind."""
    return _ANY_ART_KEY.fullmatch(key) is not None


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
    # Never the URL: it grants write access to the bucket until it expires.
    log.info(
        "upload.ticket_issued",
        kind=kind,
        content_type=data.content_type,
        size=data.size,
        art_key=key,
    )
    return UploadTicket(upload_url=upload_url, art_key=key, expires_in=settings.upload_url_ttl_s)


async def verify_art_key(
    s3: S3Client, settings: Settings, user_id: UUID, kind: ArtKind, key: str
) -> None:
    """Accepts a key only if this user uploaded it and the object is an allowed image.

    A presigned PUT can't cap the size on R2, so the stored object is checked here as well.
    """
    if re.fullmatch(_art_key_pattern(re.escape(kind), str(user_id)), key) is None:
        raise AppError(422, "invalid_art_key", "This art key wasn't issued to you for this use")

    started = time.perf_counter()
    info = await head_object(s3, settings.r2_bucket, key)
    log.debug(
        "upload.art_checked",
        art_key=key,
        found=info is not None,
        size=info.size if info is not None else None,
        content_type=info.content_type if info is not None else None,
        duration_ms=elapsed_ms(started),
    )
    if info is None:
        raise AppError(422, "invalid_art_key", "The art hasn't been uploaded yet")
    if info.size > settings.upload_max_bytes:
        raise AppError(
            422, "invalid_art_key", f"The art is larger than {settings.upload_max_bytes} bytes"
        )
    if info.content_type not in ART_CONTENT_TYPES:
        raise AppError(422, "invalid_art_key", "The art isn't a PNG, JPEG or WebP image")
