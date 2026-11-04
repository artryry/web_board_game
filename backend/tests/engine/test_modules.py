"""Checks every built-in module: keys, params bounds, cost, dmg use and the schema contract."""

import json
from typing import Any

import pytest
from pydantic import ValidationError

from app.engine.registry import (
    DmgUse,
    FeatureModule,
    FieldEffectModule,
    Module,
    PhaseModule,
    SpellModule,
    registry,
)

BASES: tuple[type[Module], ...] = (PhaseModule, FeatureModule, SpellModule, FieldEffectModule)
ALL_MODULES: list[type[Module]] = [cls for base in BASES for cls in registry.all(base)]

STARTER_KEYS: dict[type[Module], set[str]] = {
    PhaseModule: {
        "draw",
        "gain_mana",
        "action_phase",
        "lane_combat",
        "discard_to_hand_limit",
        "end_turn",
    },
    FeatureModule: {
        "taunt",
        "charge",
        "ranged",
        "armor",
        "lifesteal_section",
        "deathrattle_damage",
        "field_affinity",
    },
    SpellModule: {
        "deal_damage",
        "heal",
        "draw_cards",
        "buff",
        "summon_token",
        "move_enemy",
        "damage_section",
    },
    FieldEffectModule: {
        "stat_bonus",
        "section_hp_bonus",
        "free_move",
        "mana_discount",
        "turn_start_heal_section",
        "spell_power",
    },
}

FEATURE_COSTS = [
    ("taunt", {}, 2),
    ("charge", {}, 2),
    ("ranged", {}, 2),
    ("lifesteal_section", {}, 2),
    ("armor", {"amount": 3}, 3),
    ("deathrattle_damage", {"amount": 2}, 2),
    ("field_affinity", {"bonus": 2}, 2),
]

SPELL_COSTS = [
    ("deal_damage", {}, 1),
    ("damage_section", {}, 2),
    ("heal", {"target": "section"}, 1),
    ("draw_cards", {"count": 2}, 4),
    ("buff", {"dmg": 2, "hp": 3}, 5),
    ("summon_token", {"hp": 2, "dmg": 1}, 3),
    ("move_enemy", {}, 2),
]

SPELL_DMG_USE = {
    "deal_damage": DmgUse.DAMAGE,
    "damage_section": DmgUse.DAMAGE,
    "heal": DmgUse.HEAL,
    "draw_cards": DmgUse.NONE,
    "buff": DmgUse.NONE,
    "summon_token": DmgUse.NONE,
    "move_enemy": DmgUse.NONE,
}


def _module_id(cls: type[Module]) -> str:
    return f"{cls.kind}:{cls.key}"


@pytest.mark.parametrize("base", BASES, ids=lambda base: base.__name__)
def test_every_starter_module_is_registered(base: type[Module]) -> None:
    assert {cls.key for cls in registry.all(base)} == STARTER_KEYS[base]


@pytest.mark.parametrize("module", ALL_MODULES, ids=_module_id)
def test_default_params_are_valid(module: type[Module]) -> None:
    module.Params()


@pytest.mark.parametrize("module", ALL_MODULES, ids=_module_id)
def test_unknown_params_are_rejected(module: type[Module]) -> None:
    with pytest.raises(ValidationError):
        module.Params.model_validate({"unknown": 1})


@pytest.mark.parametrize("module", ALL_MODULES, ids=_module_id)
def test_int_params_are_bounded(module: type[Module]) -> None:
    for name, prop in module.Params.model_json_schema()["properties"].items():
        if prop["type"] != "integer":
            continue
        low, high = prop["minimum"], prop["maximum"]
        module.Params.model_validate({name: low})
        module.Params.model_validate({name: high})
        for bad in (low - 1, high + 1):
            with pytest.raises(ValidationError):
                module.Params.model_validate({name: bad})


def _is_supported_property(prop: dict[str, Any]) -> bool:
    """The property types the frontend's SchemaForm can render."""
    match prop.get("type"):
        case "integer":
            return "minimum" in prop and "maximum" in prop
        case "number" | "boolean":
            return True
        case "string":
            return "enum" in prop
        case "array":
            return "enum" in prop.get("items", {})
        case _:
            return False


@pytest.mark.parametrize("module", ALL_MODULES, ids=_module_id)
def test_params_schema_fits_the_schema_form_contract(module: type[Module]) -> None:
    schema = module.Params.model_json_schema()

    assert "$ref" not in json.dumps(schema)
    assert "$defs" not in schema
    assert schema["additionalProperties"] is False
    for name, prop in schema.get("properties", {}).items():
        assert _is_supported_property(prop), f"{name}: {prop}"


@pytest.mark.parametrize(("key", "params", "expected"), FEATURE_COSTS)
def test_feature_cost(key: str, params: dict[str, Any], expected: int) -> None:
    module = registry.get(FeatureModule, key)

    assert module.cost(module.Params.model_validate(params)) == expected


@pytest.mark.parametrize(("key", "params", "expected"), SPELL_COSTS)
def test_spell_cost(key: str, params: dict[str, Any], expected: int) -> None:
    module = registry.get(SpellModule, key)

    assert module.cost(module.Params.model_validate(params)) == expected


@pytest.mark.parametrize(("key", "dmg_use"), SPELL_DMG_USE.items())
def test_spell_dmg_use(key: str, dmg_use: DmgUse) -> None:
    assert registry.get(SpellModule, key).dmg_use == dmg_use


def test_only_action_phase_is_interactive() -> None:
    interactive = {cls.key for cls in registry.all(PhaseModule) if cls.interactive}

    assert interactive == {"action_phase"}


@pytest.mark.parametrize("allow", [[], ["play", "play"], ["fly"]])
def test_action_phase_allow_is_checked(allow: list[str]) -> None:
    module = registry.get(PhaseModule, "action_phase")

    with pytest.raises(ValidationError):
        module.Params.model_validate({"allow": allow})
