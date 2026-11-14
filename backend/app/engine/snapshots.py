"""What a game starts from: copies of the decks and their origin, taken when the game starts.

M6 builds these from the database and checks them against the ruleset's deck rules first; the
engine trusts their shape. Ids are strings, so the snapshots and the state stay plain JSON.
"""

from pydantic import BaseModel, ConfigDict, Field

from app.engine.cost import CardKind
from app.engine.registry import ModuleRef
from app.schemas.origin import OriginColor, OriginIcon


class _Snapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class CardSnapshot(_Snapshot):
    card_id: str
    name: str
    kind: CardKind
    origin_id: str
    mana_cost: int
    hp: int | None = None
    dmg: int | None = None
    # A creature's features, or a spell's one effect.
    abilities: list[ModuleRef] = Field(default_factory=list)
    # For display only.
    art_url: str | None = None


class OriginSnapshot(_Snapshot):
    origin_id: str
    name: str
    color: OriginColor
    icon: OriginIcon
    field_effects: list[ModuleRef] = Field(default_factory=list)
    background_art_url: str | None = None


class DeckSnapshot(_Snapshot):
    origin: OriginSnapshot
    # One entry per copy: a card with two copies is listed twice.
    cards: list[CardSnapshot]
