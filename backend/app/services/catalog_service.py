from functools import cache
from typing import Any

from app.engine.registry import (
    FeatureModule,
    FieldEffectModule,
    Module,
    PhaseModule,
    SpellModule,
    registry,
)
from app.schemas.catalog import (
    CatalogOut,
    FeatureOut,
    FieldEffectOut,
    OriginColorOut,
    PhaseOut,
    SpellOut,
)
from app.schemas.origin import ORIGIN_COLOR_HEX, ORIGIN_ICONS


def _describe(module: type[Module]) -> dict[str, Any]:
    return {
        "key": module.key,
        "name": module.name,
        "description": module.description,
        "params_schema": module.Params.model_json_schema(),
    }


@cache
def build_catalog() -> CatalogOut:
    """Built once: the registry is fixed after import."""
    return CatalogOut(
        phases=[
            PhaseOut(**_describe(module), interactive=module.interactive)
            for module in registry.all(PhaseModule)
        ],
        features=[
            FeatureOut(**_describe(module), cost=module.cost_spec)
            for module in registry.all(FeatureModule)
        ],
        spells=[
            SpellOut(**_describe(module), cost=module.cost_spec, dmg_use=module.dmg_use)
            for module in registry.all(SpellModule)
        ],
        field_effects=[
            FieldEffectOut(**_describe(module)) for module in registry.all(FieldEffectModule)
        ],
        origin_colors=[OriginColorOut(key=key, hex=hex_) for key, hex_ in ORIGIN_COLOR_HEX.items()],
        origin_icons=list(ORIGIN_ICONS),
    )
