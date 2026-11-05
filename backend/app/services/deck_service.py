from collections.abc import Collection
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings
from app.core.errors import AppError
from app.models.card import Card
from app.models.deck import Deck, DeckCard
from app.schemas.common import PageParams
from app.schemas.deck import (
    MAX_DECK_SIZE,
    DeckCardOut,
    DeckCreate,
    DeckOut,
    DeckSummaryOut,
    DeckUpdate,
)
from app.services import card_service, origin_service
from app.services.common import get_owned, paginate

# Loads a deck's rows and their cards in two extra queries.
WITH_CARDS = selectinload(Deck.cards).selectinload(DeckCard.card)


def deck_card_outs(deck: Deck, settings: Settings) -> list[DeckCardOut]:
    entries = sorted(deck.cards, key=lambda entry: card_service.card_sort_key(entry.card))
    return [
        DeckCardOut(card=card_service.card_out(entry.card, settings), count=entry.count)
        for entry in entries
    ]


def deck_out(deck: Deck, settings: Settings) -> DeckOut:
    summary = DeckSummaryOut.model_validate(deck)
    return DeckOut(**summary.model_dump(), cards=deck_card_outs(deck, settings))


async def list_decks(db: AsyncSession, user_id: UUID, page: PageParams) -> tuple[list[Deck], int]:
    """Newest first. The cards aren't loaded: `card_count` is enough for a list."""
    stmt = select(Deck).where(Deck.owner_id == user_id).order_by(Deck.created_at.desc(), Deck.id)
    return await paginate(db, stmt, page)


async def get_deck(db: AsyncSession, user_id: UUID, deck_id: UUID, with_cards: bool = True) -> Deck:
    options = [WITH_CARDS] if with_cards else []
    return await get_owned(
        db, Deck, deck_id, user_id, "deck_not_found", "Deck not found", options=options
    )


async def load_deck(db: AsyncSession, deck_id: UUID) -> Deck:
    """A fresh copy of a deck with its cards, for example after a write: `card_count` and
    `updated_at` are computed by the database."""
    deck = await db.scalar(
        select(Deck)
        .where(Deck.id == deck_id)
        .options(WITH_CARDS)
        .execution_options(populate_existing=True)
    )
    if deck is None:
        raise AppError(404, "deck_not_found", "Deck not found")
    return deck


def _invalid_cards(message: str) -> AppError:
    return AppError(422, "invalid_deck_cards", message)


async def _owned_cards(
    db: AsyncSession, user_id: UUID, card_ids: Collection[UUID]
) -> dict[UUID, Card]:
    if not card_ids:
        return {}
    cards = await db.scalars(select(Card).where(Card.id.in_(card_ids), Card.owner_id == user_id))
    return {card.id: card for card in cards}


def _replace_cards(deck: Deck, counts: dict[UUID, int], cards: dict[UUID, Card]) -> bool:
    """Makes `deck.cards` match `counts`, and says whether anything changed.

    Kept rows are updated in place rather than deleted and inserted again, because one flush
    can't delete and insert the same primary key.
    """
    changed = False
    for entry in list(deck.cards):
        count = counts.get(entry.card_id)
        if count is None:
            deck.cards.remove(entry)
            changed = True
        elif entry.count != count:
            entry.count = count
            changed = True
    held = {entry.card_id for entry in deck.cards}
    for card_id, count in counts.items():
        if card_id not in held:
            deck.cards.append(DeckCard(card=cards[card_id], count=count))
            changed = True
    return changed


async def _apply(db: AsyncSession, user_id: UUID, deck: Deck, data: DeckCreate) -> None:
    if await origin_service.find_readable(db, user_id, data.origin_id) is None:
        raise AppError(422, "invalid_origin", "Use one of your origins or a system origin")

    counts = {entry.card_id: entry.count for entry in data.cards}
    if len(counts) != len(data.cards):
        raise _invalid_cards("List each card once, with its number of copies in `count`")
    if sum(counts.values()) > MAX_DECK_SIZE:
        raise AppError(422, "deck_too_large", f"A deck holds at most {MAX_DECK_SIZE} cards")

    cards = await _owned_cards(db, user_id, counts.keys())
    if len(cards) != len(counts):
        raise _invalid_cards("A deck can only hold your own cards")

    neutral_id = await origin_service.neutral_origin_id(db)
    misfits = sorted(
        (card for card in cards.values() if card.origin_id not in (data.origin_id, neutral_id)),
        key=lambda card: (card.name.lower(), card.id),
    )
    if misfits:
        raise AppError(
            422,
            "card_origin_mismatch",
            f"{len(misfits)} card(s) are neither of the deck's origin nor neutral",
            extra={"cards": [{"id": str(card.id), "name": card.name} for card in misfits]},
        )

    deck.name = data.name
    deck.origin_id = data.origin_id
    if _replace_cards(deck, counts, cards) and deck.id is not None:
        # Only deck_cards rows changed, so the decks row gets no UPDATE of its own.
        deck.updated_at = func.clock_timestamp()


async def create_deck(db: AsyncSession, user_id: UUID, data: DeckCreate) -> Deck:
    deck = Deck(owner_id=user_id, cards=[])
    await _apply(db, user_id, deck, data)
    db.add(deck)
    await db.commit()
    return await load_deck(db, deck.id)


async def update_deck(db: AsyncSession, user_id: UUID, deck_id: UUID, data: DeckUpdate) -> Deck:
    deck = await get_deck(db, user_id, deck_id)
    current = {
        "name": deck.name,
        "origin_id": deck.origin_id,
        "cards": [{"card_id": entry.card_id, "count": entry.count} for entry in deck.cards],
    }
    # The merged deck is checked as a whole, so changing the origin re-checks every card.
    merged = DeckCreate.model_validate(current | data.model_dump(exclude_unset=True))
    await _apply(db, user_id, deck, merged)
    await db.commit()
    return await load_deck(db, deck.id)


async def delete_deck(db: AsyncSession, user_id: UUID, deck_id: UUID) -> None:
    """Its deck_cards rows and share code go with it (ON DELETE CASCADE); the cards stay."""
    deck = await get_deck(db, user_id, deck_id, with_cards=False)
    await db.delete(deck)
    await db.commit()
