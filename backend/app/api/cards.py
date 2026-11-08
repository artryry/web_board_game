from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, status

from app.core.deps import S3, AppSettings, CurrentUser, Db
from app.schemas.card import (
    CardCreate,
    CardListQuery,
    CardOut,
    CardUpdate,
    SuggestCostRequest,
    SuggestCostResponse,
)
from app.schemas.common import Page
from app.services import card_service

router = APIRouter(prefix="/cards", tags=["cards"])


@router.get("", response_model=Page[CardOut])
async def list_cards(
    query: Annotated[CardListQuery, Query()],
    user: CurrentUser,
    db: Db,
    settings: AppSettings,
) -> Page[CardOut]:
    cards, total = await card_service.list_cards(db, user.id, query, query.page())
    return Page[CardOut](
        items=[card_service.card_out(card, settings) for card in cards], total=total
    )


@router.post("", response_model=CardOut, status_code=status.HTTP_201_CREATED)
async def create_card(
    data: CardCreate, user: CurrentUser, db: Db, s3: S3, settings: AppSettings
) -> CardOut:
    card = await card_service.create_card(db, s3, settings, user.id, data)
    return card_service.card_out(card, settings)


# Declared before "/{card_id}" so the literal path wins.
@router.post("/suggest-cost", response_model=SuggestCostResponse)
async def suggest_cost(data: SuggestCostRequest, _user: CurrentUser) -> SuggestCostResponse:
    return SuggestCostResponse(suggested_mana_cost=card_service.suggest_cost(data))


@router.get("/{card_id}", response_model=CardOut)
async def get_card(card_id: UUID, user: CurrentUser, db: Db, settings: AppSettings) -> CardOut:
    card = await card_service.get_card(db, user.id, card_id)
    return card_service.card_out(card, settings)


@router.patch("/{card_id}", response_model=CardOut)
async def update_card(
    card_id: UUID,
    data: CardUpdate,
    user: CurrentUser,
    db: Db,
    s3: S3,
    settings: AppSettings,
) -> CardOut:
    card = await card_service.update_card(db, s3, settings, user.id, card_id, data)
    return card_service.card_out(card, settings)


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_card(card_id: UUID, user: CurrentUser, db: Db) -> None:
    await card_service.delete_card(db, user.id, card_id)
