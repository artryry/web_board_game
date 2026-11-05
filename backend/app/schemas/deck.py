from datetime import datetime
from typing import Annotated, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.card import CardOut
from app.schemas.common import ContentName, reject_explicit_nulls

# Hard bounds for a stored deck. The ruleset (M4) sets the real size and copy limit within them;
# a deck is checked against those when it is picked for a room (M6), so an unfinished deck can be
# saved.
MAX_COPIES = 4
MAX_DECK_SIZE = 60

Copies = Annotated[int, Field(ge=1, le=MAX_COPIES)]


class DeckCardIn(BaseModel):
    card_id: UUID
    count: Copies


# Each entry holds at least one copy, so a list longer than the deck size is always too big.
DeckCards = Annotated[list[DeckCardIn], Field(max_length=MAX_DECK_SIZE)]


class DeckCreate(BaseModel):
    name: ContentName
    origin_id: UUID
    cards: DeckCards = Field(default_factory=list)


class DeckUpdate(BaseModel):
    """Partial update: only the fields that are sent change, then the whole deck is re-checked.

    `cards` replaces the whole list. Changing `origin_id` while cards of the old origin remain is
    rejected, so send both together.
    """

    name: ContentName | None = None
    origin_id: UUID | None = None
    cards: DeckCards | None = None

    @model_validator(mode="after")
    def _required_fields_not_null(self) -> Self:
        reject_explicit_nulls(self, ("name", "origin_id", "cards"))
        return self


class DeckSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    origin_id: UUID
    # The number of cards, counting every copy.
    card_count: int
    # Set while the deck is shared; null after it is revoked.
    share_code: str | None
    created_at: datetime
    updated_at: datetime


class DeckCardOut(BaseModel):
    card: CardOut
    count: int


class DeckOut(DeckSummaryOut):
    # By mana cost, then name.
    cards: list[DeckCardOut]
