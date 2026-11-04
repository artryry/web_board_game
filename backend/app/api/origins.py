from uuid import UUID

from fastapi import APIRouter, status

from app.core.deps import S3, AppSettings, CurrentUser, Db, Pagination
from app.schemas.common import Page
from app.schemas.origin import OriginCreate, OriginOut, OriginUpdate
from app.services import origin_service

router = APIRouter(prefix="/origins", tags=["origins"])


@router.get("", response_model=Page[OriginOut])
async def list_origins(
    user: CurrentUser, db: Db, settings: AppSettings, page: Pagination
) -> Page[OriginOut]:
    origins, total = await origin_service.list_origins(db, user.id, page)
    return Page[OriginOut](
        items=[origin_service.origin_out(origin, settings) for origin in origins], total=total
    )


@router.post("", response_model=OriginOut, status_code=status.HTTP_201_CREATED)
async def create_origin(
    data: OriginCreate, user: CurrentUser, db: Db, s3: S3, settings: AppSettings
) -> OriginOut:
    origin = await origin_service.create_origin(db, s3, settings, user.id, data)
    return origin_service.origin_out(origin, settings)


@router.get("/{origin_id}", response_model=OriginOut)
async def get_origin(
    origin_id: UUID, user: CurrentUser, db: Db, settings: AppSettings
) -> OriginOut:
    origin = await origin_service.get_origin(db, user.id, origin_id)
    return origin_service.origin_out(origin, settings)


@router.patch("/{origin_id}", response_model=OriginOut)
async def update_origin(
    origin_id: UUID,
    data: OriginUpdate,
    user: CurrentUser,
    db: Db,
    s3: S3,
    settings: AppSettings,
) -> OriginOut:
    origin = await origin_service.update_origin(db, s3, settings, user.id, origin_id, data)
    return origin_service.origin_out(origin, settings)


@router.delete("/{origin_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_origin(origin_id: UUID, user: CurrentUser, db: Db) -> None:
    await origin_service.delete_origin(db, user.id, origin_id)
