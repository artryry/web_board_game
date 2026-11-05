from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError
from app.engine.cost import CardKind, balance, card_points, suggest_mana_cost
from app.engine.registry import (
    CostedModule,
    DmgUse,
    FeatureModule,
    ModuleRef,
    SpellModule,
    registry,
)
from app.models.card import Card
from app.models.deck import Deck, DeckCard
from app.schemas.card import CardCreate, CardFilters, CardOut, CardUpdate, SuggestCostRequest
from app.schemas.common import PageParams
from app.services import card_group_service, origin_service, upload_service
from app.services.common import (
    get_owned,
    has_duplicate_keys,
    id_name_list,
    paginate,
    resolve_module,
)
from app.storage.client import ArtKind, S3Client, public_url


@dataclass(frozen=True)
class CardContent:
    """A card's stats and abilities after the kind rules, ready to store."""

    hp: int | None
    dmg: int | None
    abilities: list[dict[str, Any]]
    ability_costs: list[int]

    def suggested_mana_cost(self, kind: CardKind) -> int:
        return suggest_mana_cost(card_points(kind, self.hp, self.dmg, self.ability_costs))


def _invalid_stats(message: str) -> AppError:
    return AppError(422, "invalid_stats", message)


def _invalid_abilities(message: str) -> AppError:
    return AppError(422, "invalid_abilities", message)


def _resolve_all[M: CostedModule](
    base: type[M], refs: Sequence[ModuleRef]
) -> tuple[list[dict[str, Any]], list[int], list[type[M]]]:
    abilities, costs, modules = [], [], []
    for ref in refs:
        module, params = resolve_module(base, ref)
        abilities.append({"key": ref.key, "params": params.model_dump(mode="json")})
        costs.append(module.cost(params))
        modules.append(module)
    return abilities, costs, modules


def _spell_dmg(effect: type[SpellModule], dmg: int | None) -> int | None:
    match effect.dmg_use:
        case DmgUse.DAMAGE if dmg is None or not 1 <= dmg <= 99:
            raise _invalid_stats(f"'{effect.key}' needs dmg between 1 and 99")
        case DmgUse.HEAL if dmg is None or not -99 <= dmg <= -1:
            raise _invalid_stats(f"'{effect.key}' needs dmg between -99 and -1 (the amount healed)")
        case DmgUse.NONE if dmg:
            raise _invalid_stats(f"'{effect.key}' doesn't use dmg; leave it empty")
        case DmgUse.NONE:
            return None  # 0 and null mean the same here; store null.
    return dmg


def validate_content(
    kind: CardKind, hp: int | None, dmg: int | None, refs: Sequence[ModuleRef]
) -> CardContent:
    """The kind rules: a creature has hp, dmg and 0-2 features; a spell has one spell effect,
    no hp, and a dmg that matches the effect."""
    if has_duplicate_keys(refs):
        raise _invalid_abilities("A card can't have the same ability twice")

    if kind == "creature":
        if hp is None or dmg is None:
            raise _invalid_stats("A creature needs both hp and dmg")
        if dmg < 0:
            raise _invalid_stats("A creature's dmg must be between 0 and 99")
        abilities, costs, _ = _resolve_all(FeatureModule, refs)
        return CardContent(hp=hp, dmg=dmg, abilities=abilities, ability_costs=costs)

    if hp is not None:
        raise _invalid_stats("A spell has no hp")
    if len(refs) != 1:
        raise _invalid_abilities("A spell needs exactly one spell effect")
    abilities, costs, (effect,) = _resolve_all(SpellModule, refs)
    return CardContent(
        hp=None, dmg=_spell_dmg(effect, dmg), abilities=abilities, ability_costs=costs
    )


def _stored_ability_costs(card: Card) -> list[int]:
    base: type[CostedModule] = FeatureModule if card.kind == "creature" else SpellModule
    costs = []
    for ability in card.abilities:
        module = registry.get(base, ability["key"])
        costs.append(module.cost(module.Params.model_validate(ability["params"])))
    return costs


def card_sort_key(card: Card) -> tuple[int, str, UUID]:
    """The order of cards in a deck or a share preview: by mana cost, then name."""
    return card.mana_cost, card.name.lower(), card.id


def card_out(card: Card, settings: Settings) -> CardOut:
    kind: CardKind = "creature" if card.kind == "creature" else "spell"
    suggested = suggest_mana_cost(card_points(kind, card.hp, card.dmg, _stored_ability_costs(card)))
    return CardOut.model_validate(
        {
            "id": card.id,
            "kind": kind,
            "name": card.name,
            "origin_id": card.origin_id,
            "mana_cost": card.mana_cost,
            "hp": card.hp,
            "dmg": card.dmg,
            "abilities": card.abilities,
            "group_id": card.group_id,
            "art_key": card.art_key,
            "art_url": public_url(settings.r2_public_base_url, card.art_key)
            if card.art_key
            else None,
            "suggested_mana_cost": suggested,
            "balance": balance(card.mana_cost, suggested),
            "created_at": card.created_at,
            "updated_at": card.updated_at,
        }
    )


async def list_cards(
    db: AsyncSession, user_id: UUID, filters: CardFilters, page: PageParams
) -> tuple[list[Card], int]:
    """Newest first."""
    stmt = select(Card).where(Card.owner_id == user_id)
    if filters.origin_id is not None:
        stmt = stmt.where(Card.origin_id == filters.origin_id)
    if filters.kind is not None:
        stmt = stmt.where(Card.kind == filters.kind)
    if filters.group_id is not None:
        stmt = stmt.where(Card.group_id == filters.group_id)
    if filters.ungrouped:
        stmt = stmt.where(Card.group_id.is_(None))
    return await paginate(db, stmt.order_by(Card.created_at.desc(), Card.id), page)


async def get_card(db: AsyncSession, user_id: UUID, card_id: UUID) -> Card:
    return await get_owned(db, Card, card_id, user_id, "card_not_found", "Card not found")


async def _decks_holding(
    db: AsyncSession, card_id: UUID, origin_other_than: UUID | None = None
) -> list[dict[str, str]]:
    # Queried here rather than in deck_service, which imports this module for card_out.
    stmt = (
        select(Deck.id, Deck.name)
        .join(DeckCard, DeckCard.deck_id == Deck.id)
        .where(DeckCard.card_id == card_id)
        .order_by(func.lower(Deck.name), Deck.id)
    )
    if origin_other_than is not None:
        stmt = stmt.where(Deck.origin_id != origin_other_than)
    return await id_name_list(db, stmt)


async def _ensure_not_in_decks(db: AsyncSession, card_id: UUID) -> None:
    decks = await _decks_holding(db, card_id)
    if decks:
        raise AppError(
            409,
            "card_in_use",
            f"{len(decks)} deck(s) still hold this card. Remove it from them first.",
            extra={"decks": decks},
        )


async def _ensure_fits_decks(db: AsyncSession, card_id: UUID, origin_id: UUID) -> None:
    """A deck holds cards of its own origin plus neutral ones, so a new origin must still fit."""
    if origin_id == await origin_service.neutral_origin_id(db):
        return
    decks = await _decks_holding(db, card_id, origin_other_than=origin_id)
    if decks:
        raise AppError(
            409,
            "card_in_use",
            f"{len(decks)} deck(s) of another origin hold this card. "
            "Remove it from them first, or make it neutral.",
            extra={"decks": decks},
        )


async def _apply(
    db: AsyncSession, s3: S3Client, settings: Settings, user_id: UUID, card: Card, data: CardCreate
) -> None:
    content = validate_content(data.kind, data.hp, data.dmg, data.abilities)

    if await origin_service.find_readable(db, user_id, data.origin_id) is None:
        raise AppError(422, "invalid_origin", "Use one of your origins or a system origin")
    # A new card has no origin yet, and no deck holds it.
    if card.origin_id is not None and data.origin_id != card.origin_id:
        await _ensure_fits_decks(db, card.id, data.origin_id)
    if data.group_id is not None:
        if await card_group_service.find_owned(db, user_id, data.group_id) is None:
            raise AppError(422, "invalid_group", "Use one of your card groups")
    if data.art_key is not None and data.art_key != card.art_key:
        await upload_service.verify_art_key(s3, settings, user_id, ArtKind.CARD, data.art_key)

    card.kind = data.kind
    card.name = data.name
    card.origin_id = data.origin_id
    card.mana_cost = data.mana_cost
    card.hp = content.hp
    card.dmg = content.dmg
    card.abilities = content.abilities
    card.group_id = data.group_id
    card.art_key = data.art_key


async def create_card(
    db: AsyncSession, s3: S3Client, settings: Settings, user_id: UUID, data: CardCreate
) -> Card:
    card = Card(owner_id=user_id)
    await _apply(db, s3, settings, user_id, card, data)
    db.add(card)
    await db.commit()
    return card


async def update_card(
    db: AsyncSession,
    s3: S3Client,
    settings: Settings,
    user_id: UUID,
    card_id: UUID,
    data: CardUpdate,
) -> Card:
    card = await get_card(db, user_id, card_id)
    current = {
        "kind": card.kind,
        "name": card.name,
        "origin_id": card.origin_id,
        "mana_cost": card.mana_cost,
        "hp": card.hp,
        "dmg": card.dmg,
        "abilities": card.abilities,
        "group_id": card.group_id,
        "art_key": card.art_key,
    }
    # The merged card is checked as a whole, so changing `kind` re-checks every rule.
    merged = CardCreate.model_validate(current | data.model_dump(exclude_unset=True))
    await _apply(db, s3, settings, user_id, card, merged)
    await db.commit()
    return card


async def delete_card(db: AsyncSession, user_id: UUID, card_id: UUID) -> None:
    card = await get_card(db, user_id, card_id)
    await _ensure_not_in_decks(db, card.id)
    await db.delete(card)
    try:
        await db.commit()
    except IntegrityError:
        # A deck took the card after our check, and the FK check at COMMIT stopped the delete.
        await db.rollback()
        await _ensure_not_in_decks(db, card_id)
        raise


def suggest_cost(data: SuggestCostRequest) -> int:
    return validate_content(data.kind, data.hp, data.dmg, data.abilities).suggested_mana_cost(
        data.kind
    )
