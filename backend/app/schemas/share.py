from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.schemas.card_group import CardGroupOut
from app.schemas.deck import DeckCardOut, DeckOut
from app.schemas.origin import OriginOut


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


SharePreview = Annotated[DeckPreview | CardGroupPreview, Field(discriminator="kind")]


class DeckImported(BaseModel):
    kind: Literal["deck"] = "deck"
    deck: DeckOut


class CardGroupImported(BaseModel):
    kind: Literal["card_group"] = "card_group"
    group: CardGroupOut


ImportResult = Annotated[DeckImported | CardGroupImported, Field(discriminator="kind")]
