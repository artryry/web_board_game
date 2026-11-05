from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.card_group import CardGroup
from app.schemas.card_group import CardGroupCreate, CardGroupUpdate
from app.schemas.common import CONTENT_NAME_MAX_LENGTH, PageParams
from app.services.common import get_owned, paginate


async def list_groups(
    db: AsyncSession, user_id: UUID, page: PageParams
) -> tuple[list[CardGroup], int]:
    stmt = (
        select(CardGroup)
        .where(CardGroup.owner_id == user_id)
        .order_by(func.lower(CardGroup.name), CardGroup.id)
    )
    return await paginate(db, stmt, page)


async def find_owned(db: AsyncSession, user_id: UUID, group_id: UUID) -> CardGroup | None:
    group = await db.get(CardGroup, group_id)
    if group is None or group.owner_id != user_id:
        return None
    return group


async def get_group(db: AsyncSession, user_id: UUID, group_id: UUID) -> CardGroup:
    return await get_owned(
        db, CardGroup, group_id, user_id, "group_not_found", "Card group not found"
    )


async def ensure_name_free(
    db: AsyncSession, user_id: UUID, name: str, except_id: UUID | None = None
) -> None:
    stmt = select(CardGroup.id).where(
        CardGroup.owner_id == user_id, func.lower(CardGroup.name) == name.lower()
    )
    if except_id is not None:
        stmt = stmt.where(CardGroup.id != except_id)
    if await db.scalar(stmt) is not None:
        raise AppError(409, "group_name_taken", "You already have a group with this name")


async def free_name(db: AsyncSession, user_id: UUID, name: str) -> str:
    """`name`, or the first free `name (2)`, `name (3)`, ... cut to fit the name length."""
    taken = set(
        await db.scalars(select(func.lower(CardGroup.name)).where(CardGroup.owner_id == user_id))
    )
    candidate = name
    number = 2
    while candidate.lower() in taken:
        suffix = f" ({number})"
        candidate = name[: CONTENT_NAME_MAX_LENGTH - len(suffix)].rstrip() + suffix
        number += 1
    return candidate


async def _commit_name(
    db: AsyncSession, group: CardGroup, user_id: UUID, name: str, except_id: UUID | None
) -> None:
    try:
        await db.commit()
    except IntegrityError:
        # Another request saved the same name after our check.
        await db.rollback()
        await ensure_name_free(db, user_id, name, except_id)
        raise
    # Loads card_count, which isn't set on a freshly inserted row.
    await db.refresh(group)


async def create_group(db: AsyncSession, user_id: UUID, data: CardGroupCreate) -> CardGroup:
    await ensure_name_free(db, user_id, data.name)
    group = CardGroup(owner_id=user_id, name=data.name)
    db.add(group)
    await _commit_name(db, group, user_id, data.name, except_id=None)
    return group


async def rename_group(
    db: AsyncSession, user_id: UUID, group_id: UUID, data: CardGroupUpdate
) -> CardGroup:
    group = await get_group(db, user_id, group_id)
    await ensure_name_free(db, user_id, data.name, except_id=group.id)
    group.name = data.name
    await _commit_name(db, group, user_id, data.name, except_id=group.id)
    return group


async def delete_group(db: AsyncSession, user_id: UUID, group_id: UUID) -> None:
    """The cards stay: the database moves them to ungrouped (ON DELETE SET NULL). The share
    code goes with the group (ON DELETE CASCADE)."""
    group = await get_group(db, user_id, group_id)
    await db.delete(group)
    await db.commit()
