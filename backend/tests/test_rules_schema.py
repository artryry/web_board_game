"""The shape of the rules JSON: defaults, bounds, unknown keys and the schema version."""

from typing import Any

import pytest

from app.schemas.rules import RulesetDefinition
from app.services.rules_service import validate_definition

# The default ruleset as backend_plan §6 writes it, with every param filled in. The seed
# migration inserts the same JSON; tests/test_rulesets.py checks the seeded row against it.
DEFAULT_DEFINITION: dict[str, Any] = {
    "schema_version": 1,
    "board": {"lanes": 3, "slots_per_section": 3, "section_hp": 20},
    "deck": {"size": 30, "max_copies": 2, "allow_neutral": True},
    "mana": {"start": 1, "per_turn": 1, "max": 10},
    "hand": {"max_size": 10, "second_player_bonus_card": True},
    "setup": [{"key": "draw", "params": {"count": 3}}],
    "turn": [
        {"key": "gain_mana", "params": {}},
        {"key": "draw", "params": {"count": 1}},
        {
            "key": "action_phase",
            "params": {"actor": "active", "allow": ["play", "move", "attack"], "time_limit_s": 90},
        },
        {"key": "end_turn", "params": {}},
    ],
}

# (section, field, lowest, highest)
BOUNDS = [
    ("board", "lanes", 1, 5),
    ("board", "slots_per_section", 1, 5),
    ("board", "section_hp", 1, 100),
    ("deck", "size", 10, 60),
    ("deck", "max_copies", 1, 4),
    ("mana", "start", 0, 20),
    ("mana", "per_turn", 1, 5),
    ("mana", "max", 1, 20),
    ("hand", "max_size", 1, 15),
]


def errors_of(definition: dict[str, Any]) -> list[tuple[list[str | int], str]]:
    result, errors = validate_definition(definition)
    assert (result is None) == bool(errors)
    return [(error.path, error.code) for error in errors]


def with_value(section: str, field: str, value: Any) -> dict[str, Any]:
    values = {field: value}
    if (section, field) == ("mana", "start"):
        values["max"] = 20  # start may not exceed max
    return {section: values}


# --- defaults ---


def test_defaults_are_the_default_ruleset() -> None:
    assert RulesetDefinition().model_dump(mode="json") == DEFAULT_DEFINITION


def test_an_empty_definition_is_the_default() -> None:
    result, errors = validate_definition({})

    assert errors == []
    assert result == RulesetDefinition()


def test_the_default_ruleset_validates_unchanged() -> None:
    result, errors = validate_definition(DEFAULT_DEFINITION)

    assert errors == []
    assert result is not None
    assert result.model_dump(mode="json") == DEFAULT_DEFINITION


# --- bounds ---


@pytest.mark.parametrize(("section", "field", "lowest", "highest"), BOUNDS)
def test_bounds_accept_the_edges(section: str, field: str, lowest: int, highest: int) -> None:
    assert errors_of(with_value(section, field, lowest)) == []
    assert errors_of(with_value(section, field, highest)) == []


@pytest.mark.parametrize(("section", "field", "lowest", "highest"), BOUNDS)
def test_bounds_reject_values_outside(section: str, field: str, lowest: int, highest: int) -> None:
    expected = [([section, field], "invalid_value")]

    assert errors_of(with_value(section, field, lowest - 1)) == expected
    assert errors_of(with_value(section, field, highest + 1)) == expected


@pytest.mark.parametrize(
    ("definition", "path"),
    [
        ({"board": {"lanes": "three"}}, ["board", "lanes"]),
        ({"deck": {"allow_neutral": "maybe"}}, ["deck", "allow_neutral"]),
        ({"hand": None}, ["hand"]),
        ({"turn": "end_turn"}, ["turn"]),
        ({"turn": [{"params": {}}]}, ["turn", 0, "key"]),
        ({"turn": [{"key": "end_turn", "params": []}]}, ["turn", 0, "params"]),
    ],
)
def test_wrong_types_are_invalid_values(definition: dict[str, Any], path: list[str | int]) -> None:
    assert errors_of(definition) == [(path, "invalid_value")]


def test_setup_may_be_empty() -> None:
    assert errors_of({"setup": []}) == []


@pytest.mark.parametrize(
    "definition",
    [
        {"setup": [{"key": "draw"}] * 6},
        {"turn": []},
        {"turn": [{"key": "draw"}] * 11 + [{"key": "action_phase"}, {"key": "end_turn"}]},
    ],
    ids=["setup_above_5", "turn_empty", "turn_above_12"],
)
def test_pipeline_lengths(definition: dict[str, Any]) -> None:
    (pipeline,) = definition

    assert errors_of(definition) == [([pipeline], "invalid_value")]


# --- unknown keys ---


@pytest.mark.parametrize(
    ("definition", "path"),
    [
        ({"rounds": 3}, ["rounds"]),
        ({"board": {"rows": 2}}, ["board", "rows"]),
        ({"hand": {"start_size": 3}}, ["hand", "start_size"]),
        (
            {"turn": [{"key": "action_phase"}, {"key": "end_turn", "module": "end_turn"}]},
            ["turn", 1, "module"],
        ),
    ],
)
def test_unknown_keys_are_rejected(definition: dict[str, Any], path: list[str | int]) -> None:
    assert errors_of(definition) == [(path, "invalid_value")]


# --- schema version ---


@pytest.mark.parametrize("version", [0, 2])
def test_unsupported_schema_version_is_the_only_error(version: int) -> None:
    definition = {"schema_version": version, "board": {"lanes": 99}, "turn": []}

    assert errors_of(definition) == [(["schema_version"], "unsupported_schema_version")]


def test_schema_version_of_the_wrong_type() -> None:
    assert errors_of({"schema_version": "1"}) == [(["schema_version"], "invalid_value")]
