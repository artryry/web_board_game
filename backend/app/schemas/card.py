from datetime import datetime
from typing import Annotated, Self
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.engine.cost import MAX_MANA_COST, MIN_MANA_COST, Balance, CardKind
from app.engine.registry import ModuleRef
from app.schemas.common import (
    DEFAULT_PAGE_LIMIT,
    MAX_PAGE_LIMIT,
    ArtKey,
    ContentName,
    PageParams,
    reject_explicit_nulls,
)

# A creature has 0-2 features; a spell has exactly one spell effect (checked by the service).
MAX_ABILITIES = 2

ManaCost = Annotated[int, Field(ge=MIN_MANA_COST, le=MAX_MANA_COST)]
Hp = Annotated[int, Field(ge=1, le=99)]
# Creatures use 0..99. A spell's dmg follows its effect: 1..99 damage, -99..-1 heal, or null.
Dmg = Annotated[int, Field(ge=-99, le=99)]
Abilities = Annotated[list[ModuleRef], Field(max_length=MAX_ABILITIES)]


class CardCreate(BaseModel):
    kind: CardKind
    name: ContentName
    origin_id: UUID
    # The author's final cost. The suggestion is advice only and never changes it.
    mana_cost: ManaCost
    hp: Hp | None = None
    dmg: Dmg | None = None
    abilities: Abilities = Field(default_factory=list)
    group_id: UUID | None = None
    art_key: ArtKey | None = None


class CardUpdate(BaseModel):
    """Partial update: only the fields that are sent change, then the whole card is re-checked.

    Null clears `hp`, `dmg`, `group_id` and `art_key`. Changing `kind` to spell needs `hp: null`.
    """

    kind: CardKind | None = None
    name: ContentName | None = None
    origin_id: UUID | None = None
    mana_cost: ManaCost | None = None
    hp: Hp | None = None
    dmg: Dmg | None = None
    abilities: Abilities | None = None
    group_id: UUID | None = None
    art_key: ArtKey | None = None

    @model_validator(mode="after")
    def _required_fields_not_null(self) -> Self:
        reject_explicit_nulls(self, ("kind", "name", "origin_id", "mana_cost", "abilities"))
        return self


class CardOut(BaseModel):
    id: UUID
    kind: CardKind
    name: str
    origin_id: UUID
    mana_cost: int
    hp: int | None
    dmg: int | None
    abilities: list[ModuleRef]
    group_id: UUID | None
    art_key: str | None
    art_url: str | None
    # Information only, shown in the card library. Neither one ever changes mana_cost.
    suggested_mana_cost: int
    balance: Balance
    created_at: datetime
    updated_at: datetime


class CardFilters(BaseModel):
    origin_id: UUID | None = None
    kind: CardKind | None = None
    group_id: UUID | None = None
    # True lists only the cards that aren't in any group.
    ungrouped: bool = False

    @model_validator(mode="after")
    def _one_group_filter(self) -> Self:
        if self.group_id is not None and self.ungrouped:
            raise ValueError("Use either 'group_id' or 'ungrouped', not both")
        return self


class CardListQuery(CardFilters):
    """The whole query of `GET /api/cards`: the filters plus paging.

    FastAPI lists a query model's fields as separate parameters in OpenAPI only when the model is
    the route's only query parameter. With the shared `Pagination` dependency next to it, the
    schema showed one required `filters` object, so the generated client types were wrong.
    """

    limit: int = Field(default=DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT)
    offset: int = Field(default=0, ge=0)

    def page(self) -> PageParams:
        return PageParams(limit=self.limit, offset=self.offset)


class SuggestCostRequest(BaseModel):
    kind: CardKind
    hp: Hp | None = None
    dmg: Dmg | None = None
    abilities: Abilities = Field(default_factory=list)


class SuggestCostResponse(BaseModel):
    # No balance label here: the card editor shows only the suggestion.
    suggested_mana_cost: int
