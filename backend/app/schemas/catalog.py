from typing import Any

from pydantic import BaseModel

from app.engine.registry import CostSpec, DmgUse
from app.schemas.origin import OriginColor, OriginIcon


class ModuleOut(BaseModel):
    key: str
    name: str
    description: str
    # JSON Schema of the module's params; the frontend's SchemaForm renders it.
    params_schema: dict[str, Any]


class PhaseOut(ModuleOut):
    interactive: bool


class FeatureOut(ModuleOut):
    cost: CostSpec


class SpellOut(ModuleOut):
    cost: CostSpec
    dmg_use: DmgUse


class FieldEffectOut(ModuleOut):
    pass


class OriginColorOut(BaseModel):
    key: OriginColor
    hex: str


class CatalogOut(BaseModel):
    phases: list[PhaseOut]
    features: list[FeatureOut]
    spells: list[SpellOut]
    field_effects: list[FieldEffectOut]
    origin_colors: list[OriginColorOut]
    origin_icons: list[OriginIcon]
