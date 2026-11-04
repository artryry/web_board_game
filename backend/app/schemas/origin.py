from datetime import datetime
from typing import Annotated, Literal, Self, get_args
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.engine.registry import ModuleRef
from app.schemas.common import ArtKey, ContentName, reject_explicit_nulls

MAX_FIELD_EFFECTS = 3

# The Okabe–Ito colour-blind-safe palette, plus grey. Origins store the key, not the hex value,
# so the palette can be retuned without touching stored rows.
OriginColor = Literal[
    "orange",
    "sky_blue",
    "bluish_green",
    "yellow",
    "blue",
    "vermillion",
    "reddish_purple",
    "grey",
    "black",
]
ORIGIN_COLOR_HEX: dict[OriginColor, str] = {
    "orange": "#E69F00",
    "sky_blue": "#56B4E9",
    "bluish_green": "#009E73",
    "yellow": "#F0E442",
    "blue": "#0072B2",
    "vermillion": "#D55E00",
    "reddish_purple": "#CC79A7",
    "grey": "#999999",
    "black": "#000000",
}

# Plain icon keys; the frontend maps them to its icon set.
OriginIcon = Literal[
    "circle",
    "leaf",
    "flame",
    "waves",
    "mountain",
    "sun",
    "moon",
    "snowflake",
    "skull",
    "zap",
    "shield",
    "crown",
    "star",
    "droplet",
    "wind",
    "sparkles",
]
ORIGIN_ICONS: tuple[OriginIcon, ...] = get_args(OriginIcon)

FieldEffects = Annotated[list[ModuleRef], Field(max_length=MAX_FIELD_EFFECTS)]


class OriginCreate(BaseModel):
    name: ContentName
    color: OriginColor
    icon: OriginIcon
    field_effects: FieldEffects = Field(default_factory=list)
    background_art_key: ArtKey | None = None


class OriginUpdate(BaseModel):
    """Partial update: only the fields that are sent change. Null clears the background art."""

    name: ContentName | None = None
    color: OriginColor | None = None
    icon: OriginIcon | None = None
    field_effects: FieldEffects | None = None
    background_art_key: ArtKey | None = None

    @model_validator(mode="after")
    def _required_fields_not_null(self) -> Self:
        reject_explicit_nulls(self, ("name", "color", "icon", "field_effects"))
        return self


class OriginOut(BaseModel):
    id: UUID
    name: str
    color: OriginColor
    icon: OriginIcon
    field_effects: list[ModuleRef]
    background_art_key: str | None
    background_art_url: str | None
    # System origins are read-only templates shared by everyone.
    is_system: bool
    system_key: str | None
    created_at: datetime
    updated_at: datetime
