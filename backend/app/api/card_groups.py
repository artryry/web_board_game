from uuid import UUID

from fastapi import APIRouter, status

from app.core.deps import CurrentUser, Db, Pagination
from app.schemas.card_group import CardGroupCreate, CardGroupOut, CardGroupUpdate
from app.schemas.common import Page
from app.services import card_group_service

router = APIRouter(prefix="/card-groups", tags=["card groups"])


@router.get("", response_model=Page[CardGroupOut])
async def list_groups(user: CurrentUser, db: Db, page: Pagination) -> Page[CardGroupOut]:
    groups, total = await card_group_service.list_groups(db, user.id, page)
    return Page[CardGroupOut](
        items=[CardGroupOut.model_validate(group) for group in groups], total=total
    )


@router.post("", response_model=CardGroupOut, status_code=status.HTTP_201_CREATED)
async def create_group(data: CardGroupCreate, user: CurrentUser, db: Db) -> CardGroupOut:
    group = await card_group_service.create_group(db, user.id, data)
    return CardGroupOut.model_validate(group)


@router.get("/{group_id}", response_model=CardGroupOut)
async def get_group(group_id: UUID, user: CurrentUser, db: Db) -> CardGroupOut:
    group = await card_group_service.get_group(db, user.id, group_id)
    return CardGroupOut.model_validate(group)


@router.patch("/{group_id}", response_model=CardGroupOut)
async def rename_group(
    group_id: UUID, data: CardGroupUpdate, user: CurrentUser, db: Db
) -> CardGroupOut:
    group = await card_group_service.rename_group(db, user.id, group_id, data)
    return CardGroupOut.model_validate(group)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(group_id: UUID, user: CurrentUser, db: Db) -> None:
    await card_group_service.delete_group(db, user.id, group_id)
