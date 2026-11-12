from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.schemas.card_group import CardGroupOut
from app.schemas.deck import DeckCardOut, DeckOut
from app.schemas.origin import OriginOut
from app.schemas.rules import RulesetDefinition
from app.schemas.ruleset import RulesetOut


class ShareCodeOut(BaseModel):
    share_code: str


class DeckPreview(BaseModel):
    kind: Literal["deck"] = "deck"
    code: str
    name: str
    # The author's username.
    author: str
    origin: OriginOut
    cards: list[DeckCardOut]
    card_count: int


class CardGroupPreview(BaseModel):
    kind: Literal["card_group"] = "card_group"
    code: str
    name: str
    author: str
    # Every origin the group's cards use: system origins first, then by name.
    origins: list[OriginOut]
    # The same shape as a deck's cards; every count is 1.
    cards: list[DeckCardOut]
    card_count: int


class RulesetPreview(BaseModel):
    kind: Literal["ruleset"] = "ruleset"
    code: str
    name: str
    author: str
    definition: RulesetDefinition


SharePreview = Annotated[
    DeckPreview | CardGroupPreview | RulesetPreview, Field(discriminator="kind")
]


class DeckImported(BaseModel):
    kind: Literal["deck"] = "deck"
    deck: DeckOut


class CardGroupImported(BaseModel):
    kind: Literal["card_group"] = "card_group"
    group: CardGroupOut


class RulesetImported(BaseModel):
    kind: Literal["ruleset"] = "ruleset"
    ruleset: RulesetOut


ImportResult = Annotated[
    DeckImported | CardGroupImported | RulesetImported, Field(discriminator="kind")
]
