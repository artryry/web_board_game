from fastapi import APIRouter, status

from app.core.deps import AppSettings, CurrentUser, Db
from app.schemas.share import ImportResult, SharePreview
from app.services import share_service

router = APIRouter(prefix="/share", tags=["share"])


@router.get("/{code}", response_model=SharePreview)
async def preview(code: str, _user: CurrentUser, db: Db, settings: AppSettings) -> SharePreview:
    return await share_service.preview(db, settings, code)


@router.post("/{code}/import", response_model=ImportResult, status_code=status.HTTP_201_CREATED)
async def import_share(code: str, user: CurrentUser, db: Db, settings: AppSettings) -> ImportResult:
    return await share_service.import_share(db, settings, user.id, code)
