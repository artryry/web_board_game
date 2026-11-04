from collections.abc import Iterable
from dataclasses import dataclass
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 100

# Display name of a user's content (origin, card, card group).
ContentName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
ArtKey = Annotated[str, Field(min_length=1, max_length=255)]


@dataclass(frozen=True)
class PageParams:
    limit: int = DEFAULT_PAGE_LIMIT
    offset: int = 0


class Page[T](BaseModel):
    """One page of a list endpoint. `total` counts every matching row, not just this page."""

    items: list[T]
    total: int


def reject_explicit_nulls(model: BaseModel, fields: Iterable[str]) -> None:
    """For PATCH bodies: a field may be left out, but a required one can't be set to null."""
    for name in fields:
        if name in model.model_fields_set and getattr(model, name) is None:
            raise ValueError(f"'{name}' can't be null")
