import copy
from collections.abc import Iterable, Sequence
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.core.codes import random_code
from app.core.config import Settings
from app.core.errors import AppError
from app.core.logging_config import StepTimer, get_logger
from app.models.card import Card
from app.models.card_group import CardGroup
from app.models.deck import Deck, DeckCard
from app.models.origin import Origin
from app.models.share_code import SHARE_CODE_LENGTH, ShareCode
from app.models.user import User
from app.schemas.card_group import CardGroupOut
from app.schemas.deck import DeckCardOut
from app.schemas.share import (
    CardGroupImported,
    CardGroupPreview,
    DeckImported,
    DeckPreview,
    ImportResult,
    SharePreview,
)
from app.services import card_group_service, card_service, deck_service, origin_service

log = get_logger(__name__)

# A collision needs two equal 10-character codes (about 50 bits), so retries are a formality.
_MAX_CODE_ATTEMPTS = 5

TargetColumn = InstrumentedAttribute[UUID | None]


def _kind(column: TargetColumn) -> str:
    """The kind named in log lines: "deck" or "card_group"."""
    return column.key.removesuffix("_id")


# --- share and revoke ---


async def _get_or_create(db: AsyncSession, column: TargetColumn, target_id: UUID) -> str:
    """The target's code, made on first use. Sharing again returns the same code."""
    for attempt in range(1, _MAX_CODE_ATTEMPTS + 1):
        existing = await db.scalar(select(ShareCode.code).where(column == target_id))
        if existing is not None:
            return existing
        share = ShareCode(code=random_code(SHARE_CODE_LENGTH), **{column.key: target_id})
        try:
            async with db.begin_nested():
                db.add(share)
        except IntegrityError:
            # Either a concurrent request shared the same target (the next pass returns its
            # code), or the random code is taken (the next pass draws another one).
            log.debug("share.code_retry", kind=_kind(column), attempt=attempt)
            continue
        await db.commit()
        log.info("share.created", kind=_kind(column), target_id=target_id, code=share.code)
        return share.code
    raise RuntimeError("Couldn't store a share code")


async def _revoke(db: AsyncSession, column: TargetColumn, target_id: UUID) -> None:
    await db.execute(delete(ShareCode).where(column == target_id))
    await db.commit()
    log.info("share.revoked", kind=_kind(column), target_id=target_id)


async def share_deck(db: AsyncSession, user_id: UUID, deck_id: UUID) -> str:
    deck = await deck_service.get_deck(db, user_id, deck_id, with_cards=False)
    return await _get_or_create(db, ShareCode.deck_id, deck.id)


async def share_group(db: AsyncSession, user_id: UUID, group_id: UUID) -> str:
    group = await card_group_service.get_group(db, user_id, group_id)
    return await _get_or_create(db, ShareCode.card_group_id, group.id)


async def revoke_deck(db: AsyncSession, user_id: UUID, deck_id: UUID) -> None:
    """The old link stops working; sharing again makes a new code."""
    deck = await deck_service.get_deck(db, user_id, deck_id, with_cards=False)
    await _revoke(db, ShareCode.deck_id, deck.id)


async def revoke_group(db: AsyncSession, user_id: UUID, group_id: UUID) -> None:
    group = await card_group_service.get_group(db, user_id, group_id)
    await _revoke(db, ShareCode.card_group_id, group.id)


# --- reading shared content (the share code is the permission, so no ownership checks) ---


async def _resolve(db: AsyncSession, code: str) -> ShareCode:
    # Codes are upper case; people may type them in lower case.
    share = await db.get(ShareCode, code.strip().upper())
    if share is None:
        raise AppError(404, "share_not_found", "No deck or card group has this share code")
    return share


async def _author(db: AsyncSession, user_id: UUID) -> str:
    username = await db.scalar(select(User.username).where(User.id == user_id))
    if username is None:
        raise RuntimeError(f"User {user_id} owns shared content but doesn't exist")
    return username


async def _shared_group(db: AsyncSession, share: ShareCode) -> CardGroup:
    # The check constraint guarantees one target, and the FK that it exists.
    assert share.card_group_id is not None
    group = await db.get(CardGroup, share.card_group_id)
    assert group is not None
    return group


async def _group_cards(db: AsyncSession, group_id: UUID) -> list[Card]:
    cards = await db.scalars(select(Card).where(Card.group_id == group_id))
    return sorted(cards, key=card_service.card_sort_key)


async def _origins(db: AsyncSession, origin_ids: Iterable[UUID]) -> list[Origin]:
    """System origins first, then by name."""
    stmt = (
        select(Origin)
        .where(Origin.id.in_(set(origin_ids)))
        .order_by(Origin.owner_id.is_not(None), func.lower(Origin.name), Origin.id)
    )
    return list(await db.scalars(stmt))


# --- preview ---


async def preview(db: AsyncSession, settings: Settings, code: str) -> SharePreview:
    """What the code holds now: later edits by the author show up here."""
    share = await _resolve(db, code)

    if share.deck_id is not None:
        deck = await deck_service.load_deck(db, share.deck_id)
        (origin,) = await _origins(db, [deck.origin_id])
        return DeckPreview(
            code=share.code,
            name=deck.name,
            author=await _author(db, deck.owner_id),
            origin=origin_service.origin_out(origin, settings),
            cards=deck_service.deck_card_outs(deck, settings),
            card_count=deck.card_count,
        )

    group = await _shared_group(db, share)
    cards = await _group_cards(db, group.id)
    origins = await _origins(db, (card.origin_id for card in cards))
    return CardGroupPreview(
        code=share.code,
        name=group.name,
        author=await _author(db, group.owner_id),
        origins=[origin_service.origin_out(origin, settings) for origin in origins],
        cards=[DeckCardOut(card=card_service.card_out(card, settings), count=1) for card in cards],
        card_count=len(cards),
    )


# --- import ---


def _copied_count(origin_ids: dict[UUID, UUID]) -> int:
    """How many origins were copied: system origins map to themselves."""
    return sum(1 for source_id, target_id in origin_ids.items() if source_id != target_id)


async def _copy_origins(
    db: AsyncSession, user_id: UUID, origin_ids: Iterable[UUID]
) -> dict[UUID, UUID]:
    """Maps each source origin to the one the copies use. System origins are shared by everyone,
    so only custom ones are copied, each once however many cards use it."""
    mapping: dict[UUID, UUID] = {}
    copies: list[tuple[UUID, Origin]] = []
    for origin in await _origins(db, origin_ids):
        if origin.is_system:
            mapping[origin.id] = origin.id
            continue
        origin_copy = Origin(
            owner_id=user_id,
            name=origin.name,
            color=origin.color,
            icon=origin.icon,
            background_art_key=origin.background_art_key,
            field_effects=copy.deepcopy(origin.field_effects),
        )
        db.add(origin_copy)
        copies.append((origin.id, origin_copy))
    # Assigns the ids, and inserts the origins before the cards and decks that point at them.
    await db.flush()
    mapping.update({source_id: origin_copy.id for source_id, origin_copy in copies})
    return mapping


async def _copy_cards(
    db: AsyncSession,
    user_id: UUID,
    group_name: str,
    cards: Sequence[Card],
    origin_ids: dict[UUID, UUID],
) -> tuple[CardGroup, dict[UUID, Card]]:
    """Copies `cards` into a new group of the user's; maps each source card id to its copy.

    The copies are written directly, not through the card service: the content was checked when
    it was saved. The art key stays the author's, so the copy shares the object, which the art
    sweep keeps while any row uses it (backend_plan §10.3). A later edit that keeps the key
    doesn't check it again.
    """
    group = CardGroup(
        owner_id=user_id, name=await card_group_service.free_name(db, user_id, group_name)
    )
    db.add(group)
    await db.flush()

    copies: dict[UUID, Card] = {}
    for card in cards:
        card_copy = Card(
            owner_id=user_id,
            kind=card.kind,
            name=card.name,
            origin_id=origin_ids[card.origin_id],
            mana_cost=card.mana_cost,
            hp=card.hp,
            dmg=card.dmg,
            abilities=copy.deepcopy(card.abilities),
            group_id=group.id,
            art_key=card.art_key,
        )
        db.add(card_copy)
        copies[card.id] = card_copy
    return group, copies


async def _commit_import(db: AsyncSession, user_id: UUID, group: CardGroup | None) -> None:
    try:
        await db.commit()
    except IntegrityError:
        # The only constraint the new rows can hit is the group name, when a group with the
        # same name was saved after free_name looked.
        await db.rollback()
        if group is not None:
            await card_group_service.ensure_name_free(db, user_id, group.name)
        raise


async def _import_deck(
    db: AsyncSession, settings: Settings, user_id: UUID, share: ShareCode
) -> DeckImported:
    assert share.deck_id is not None
    steps = StepTimer(log, "share.import_step")
    source = await deck_service.load_deck(db, share.deck_id)
    entries = sorted(source.cards, key=lambda entry: card_service.card_sort_key(entry.card))
    cards = [entry.card for entry in entries]
    steps.done("source_loaded", kind="deck", cards=len(cards))
    origin_ids = await _copy_origins(
        db, user_id, {source.origin_id, *(card.origin_id for card in cards)}
    )
    steps.done("origins_copied", origins=_copied_count(origin_ids))

    # The deck's cards go into a group named after it, so the library stays tidy.
    group: CardGroup | None = None
    copies: dict[UUID, Card] = {}
    if cards:
        group, copies = await _copy_cards(db, user_id, source.name, cards, origin_ids)
    steps.done("cards_copied", cards=len(copies))

    deck = Deck(
        owner_id=user_id,
        name=source.name,
        origin_id=origin_ids[source.origin_id],
        cards=[DeckCard(card=copies[entry.card_id], count=entry.count) for entry in entries],
    )
    db.add(deck)
    await _commit_import(db, user_id, group)
    steps.done("committed")
    log.info(
        "share.imported",
        kind="deck",
        code=share.code,
        source_id=source.id,
        deck_id=deck.id,
        group_id=group.id if group is not None else None,
        cards=len(copies),
        origins=_copied_count(origin_ids),
    )
    deck = await deck_service.load_deck(db, deck.id)
    return DeckImported(deck=deck_service.deck_out(deck, settings))


async def _import_group(db: AsyncSession, user_id: UUID, share: ShareCode) -> CardGroupImported:
    steps = StepTimer(log, "share.import_step")
    source = await _shared_group(db, share)
    cards = await _group_cards(db, source.id)
    steps.done("source_loaded", kind="card_group", cards=len(cards))
    origin_ids = await _copy_origins(db, user_id, (card.origin_id for card in cards))
    steps.done("origins_copied", origins=_copied_count(origin_ids))
    group, copies = await _copy_cards(db, user_id, source.name, cards, origin_ids)
    steps.done("cards_copied", cards=len(copies))
    await _commit_import(db, user_id, group)
    steps.done("committed")
    log.info(
        "share.imported",
        kind="card_group",
        code=share.code,
        source_id=source.id,
        group_id=group.id,
        cards=len(copies),
        origins=_copied_count(origin_ids),
    )
    # Loads card_count and share_code, which aren't set on a freshly inserted row.
    await db.refresh(group)
    return CardGroupImported(group=CardGroupOut.model_validate(group))


async def import_share(
    db: AsyncSession, settings: Settings, user_id: UUID, code: str
) -> ImportResult:
    """Forks what the code holds into the user's library, in one transaction. The copy shares
    nothing editable with the original, so later edits on either side never touch the other.
    Importing your own code works as "duplicate"."""
    share = await _resolve(db, code)
    if share.deck_id is not None:
        return await _import_deck(db, settings, user_id, share)
    return await _import_group(db, user_id, share)
