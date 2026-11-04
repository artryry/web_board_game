from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError
from app.engine.registry import FieldEffectModule
from app.models.card import Card
from app.models.origin import Origin
from app.schemas.common import PageParams
from app.schemas.origin import OriginCreate, OriginOut, OriginUpdate
from app.services import upload_service
from app.services.common import has_duplicate_keys, normalize_module_refs, paginate
from app.storage.client import ArtKind, S3Client, public_url


def origin_out(origin: Origin, settings: Settings) -> OriginOut:
    art_key = origin.background_art_key
    return OriginOut.model_validate(
        {
            "id": origin.id,
            "name": origin.name,
            "color": origin.color,
            "icon": origin.icon,
            "field_effects": origin.field_effects,
            "background_art_key": art_key,
            "background_art_url": (
                public_url(settings.r2_public_base_url, art_key) if art_key else None
            ),
            "is_system": origin.is_system,
            "system_key": origin.system_key,
            "created_at": origin.created_at,
            "updated_at": origin.updated_at,
        }
    )


def _readable_by(user_id: UUID) -> Any:
    return or_(Origin.owner_id == user_id, Origin.owner_id.is_(None))


async def list_origins(
    db: AsyncSession, user_id: UUID, page: PageParams
) -> tuple[list[Origin], int]:
    """System origins first, then the user's own, each by name."""
    stmt = (
        select(Origin)
        .where(_readable_by(user_id))
        .order_by(Origin.owner_id.is_not(None), func.lower(Origin.name), Origin.id)
    )
    return await paginate(db, stmt, page)


async def find_readable(db: AsyncSession, user_id: UUID, origin_id: UUID) -> Origin | None:
    """The origin if the user may use it: their own or a system origin."""
    origin = await db.get(Origin, origin_id)
    if origin is None or (origin.owner_id is not None and origin.owner_id != user_id):
        return None
    return origin


async def get_origin(db: AsyncSession, user_id: UUID, origin_id: UUID) -> Origin:
    origin = await find_readable(db, user_id, origin_id)
    if origin is None:
        raise AppError(404, "origin_not_found", "Origin not found")
    return origin


async def _get_own_origin(db: AsyncSession, user_id: UUID, origin_id: UUID) -> Origin:
    origin = await get_origin(db, user_id, origin_id)
    if origin.is_system:
        raise AppError(
            403,
            "system_origin_read_only",
            "System origins can't be changed. Duplicate one to make your own version.",
        )
    return origin


async def _apply(
    origin: Origin, data: OriginCreate, s3: S3Client, settings: Settings, user_id: UUID
) -> None:
    if has_duplicate_keys(data.field_effects):
        raise AppError(
            422, "invalid_field_effects", "An origin can't have the same field effect twice"
        )
    field_effects = normalize_module_refs(FieldEffectModule, data.field_effects)

    art_key = data.background_art_key
    if art_key is not None and art_key != origin.background_art_key:
        await upload_service.verify_art_key(s3, settings, user_id, ArtKind.ORIGIN, art_key)

    origin.name = data.name
    origin.color = data.color
    origin.icon = data.icon
    origin.field_effects = field_effects
    origin.background_art_key = art_key


async def create_origin(
    db: AsyncSession, s3: S3Client, settings: Settings, user_id: UUID, data: OriginCreate
) -> Origin:
    origin = Origin(owner_id=user_id)
    await _apply(origin, data, s3, settings, user_id)
    db.add(origin)
    await db.commit()
    return origin


async def update_origin(
    db: AsyncSession,
    s3: S3Client,
    settings: Settings,
    user_id: UUID,
    origin_id: UUID,
    data: OriginUpdate,
) -> Origin:
    origin = await _get_own_origin(db, user_id, origin_id)
    current = {
        "name": origin.name,
        "color": origin.color,
        "icon": origin.icon,
        "field_effects": origin.field_effects,
        "background_art_key": origin.background_art_key,
    }
    # Every sent field was already validated by OriginUpdate with the same types.
    merged = OriginCreate.model_validate(current | data.model_dump(exclude_unset=True))
    await _apply(origin, merged, s3, settings, user_id)
    await db.commit()
    return origin


async def delete_origin(db: AsyncSession, user_id: UUID, origin_id: UUID) -> None:
    origin = await _get_own_origin(db, user_id, origin_id)
    cards = (
        await db.execute(
            select(Card.id, Card.name)
            .where(Card.origin_id == origin.id)
            .order_by(func.lower(Card.name), Card.id)
        )
    ).all()
    if cards:
        raise AppError(
            409,
            "origin_in_use",
            f"{len(cards)} card(s) still use this origin. Change or delete them first.",
            extra={"cards": [{"id": str(card.id), "name": card.name} for card in cards]},
        )
    await db.delete(origin)
    await db.commit()
