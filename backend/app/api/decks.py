from uuid import UUID

from fastapi import APIRouter, status

from app.core.deps import AppSettings, CurrentUser, Db, Pagination
from app.schemas.common import Page
from app.schemas.deck import DeckCreate, DeckOut, DeckSummaryOut, DeckUpdate
from app.schemas.share import ShareCodeOut
from app.services import deck_service, share_service

router = APIRouter(prefix="/decks", tags=["decks"])


@router.get("", response_model=Page[DeckSummaryOut])
async def list_decks(user: CurrentUser, db: Db, page: Pagination) -> Page[DeckSummaryOut]:
    decks, total = await deck_service.list_decks(db, user.id, page)
    return Page[DeckSummaryOut](
        items=[DeckSummaryOut.model_validate(deck) for deck in decks], total=total
    )


@router.post("", response_model=DeckOut, status_code=status.HTTP_201_CREATED)
async def create_deck(
    data: DeckCreate, user: CurrentUser, db: Db, settings: AppSettings
) -> DeckOut:
    deck = await deck_service.create_deck(db, user.id, data)
    return deck_service.deck_out(deck, settings)


@router.get("/{deck_id}", response_model=DeckOut)
async def get_deck(deck_id: UUID, user: CurrentUser, db: Db, settings: AppSettings) -> DeckOut:
    deck = await deck_service.get_deck(db, user.id, deck_id)
    return deck_service.deck_out(deck, settings)


@router.patch("/{deck_id}", response_model=DeckOut)
async def update_deck(
    deck_id: UUID, data: DeckUpdate, user: CurrentUser, db: Db, settings: AppSettings
) -> DeckOut:
    deck = await deck_service.update_deck(db, user.id, deck_id, data)
    return deck_service.deck_out(deck, settings)


@router.delete("/{deck_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_deck(deck_id: UUID, user: CurrentUser, db: Db) -> None:
    await deck_service.delete_deck(db, user.id, deck_id)


@router.post("/{deck_id}/share", response_model=ShareCodeOut)
async def share_deck(deck_id: UUID, user: CurrentUser, db: Db) -> ShareCodeOut:
    return ShareCodeOut(share_code=await share_service.share_deck(db, user.id, deck_id))


@router.delete("/{deck_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_deck_share(deck_id: UUID, user: CurrentUser, db: Db) -> None:
    await share_service.revoke_deck(db, user.id, deck_id)
