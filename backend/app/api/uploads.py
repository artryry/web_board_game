from fastapi import APIRouter

from app.core.deps import S3, AppSettings, CurrentUser
from app.schemas.upload import UploadRequest, UploadTicket
from app.services import upload_service
from app.storage.client import ArtKind

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("/card-art", response_model=UploadTicket)
async def card_art(
    data: UploadRequest, user: CurrentUser, s3: S3, settings: AppSettings
) -> UploadTicket:
    return await upload_service.request_upload(s3, settings, user.id, ArtKind.CARD, data)


@router.post("/origin-art", response_model=UploadTicket)
async def origin_art(
    data: UploadRequest, user: CurrentUser, s3: S3, settings: AppSettings
) -> UploadTicket:
    return await upload_service.request_upload(s3, settings, user.id, ArtKind.ORIGIN, data)
