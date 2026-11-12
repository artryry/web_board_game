"""The rules that need the module registry: phase keys and params, the pipeline rules, and the
cross-field mana rule. Every error comes with a path into the definition."""

from typing import Any

import pytest

from app.services.rules_service import validate_definition

ACTION = {"key": "action_phase"}
END = {"key": "end_turn"}
DRAW = {"key": "draw"}


def errors_of(definition: dict[str, Any]) -> list[tuple[list[str | int], str]]:
    result, errors = validate_definition(definition)
    assert (result is None) == bool(errors)
    return [(error.path, error.code) for error in errors]


@pytest.mark.parametrize(
    ("definition", "expected"),
    [
        pytest.param({"turn": [ACTION]}, [(["turn"], "end_turn_missing")], id="end_turn_missing"),
        pytest.param(
            {"turn": [ACTION, END, END]},
            [(["turn", 1], "end_turn_repeated")],
            id="end_turn_repeated",
        ),
        pytest.param(
            {"turn": [END, ACTION, END]},
            [(["turn", 0], "end_turn_repeated")],
            id="end_turn_repeated_before_the_last",
        ),
        pytest.param(
            {"turn": [END, ACTION]}, [(["turn", 0], "end_turn_not_last")], id="end_turn_not_last"
        ),
        pytest.param(
            {"turn": [END, END, ACTION]},
            [(["turn", 0], "end_turn_not_last"), (["turn", 1], "end_turn_repeated")],
            id="end_turn_not_last_and_repeated",
        ),
        pytest.param(
            {"turn": [DRAW, END]},
            [(["turn"], "turn_needs_interactive_phase")],
            id="turn_needs_interactive_phase",
        ),
        pytest.param(
            {"setup": [DRAW, ACTION]},
            [(["setup", 1], "setup_phase_not_allowed")],
            id="interactive_phase_in_setup",
        ),
        pytest.param(
            {"setup": [END]}, [(["setup", 0], "setup_phase_not_allowed")], id="end_turn_in_setup"
        ),
        pytest.param(
            {"turn": [{"key": "nap"}, ACTION, END]},
            [(["turn", 0, "key"], "unknown_module")],
            id="unknown_module",
        ),
        pytest.param(
            # A field effect key is not a phase.
            {"setup": [{"key": "stat_bonus"}]},
            [(["setup", 0, "key"], "unknown_module")],
            id="module_of_another_kind",
        ),
        pytest.param(
            {"turn": [{"key": "action_phase", "params": {"time_limit_s": 601}}, END]},
            [(["turn", 0, "params", "time_limit_s"], "invalid_params")],
            id="param_out_of_bounds",
        ),
        pytest.param(
            {"setup": [{"key": "draw", "params": {"count": 3, "from": "bottom"}}]},
            [(["setup", 0, "params", "from"], "invalid_params")],
            id="unknown_param",
        ),
        pytest.param(
            {"mana": {"start": 11}},
            [(["mana", "start"], "mana_start_above_max")],
            id="mana_start_above_max",
        ),
    ],
)
def test_rule_errors(definition: dict[str, Any], expected: list[tuple[list[Any], str]]) -> None:
    assert errors_of(definition) == expected


def test_every_error_is_reported_at_once() -> None:
    definition = {
        "board": {"lanes": 9},
        "mana": {"start": 15, "max": 10},
        "setup": [ACTION],
        "turn": [{"key": "draw", "params": {"count": 9, "from": "bottom"}}, {"key": "nap"}],
    }

    assert errors_of(definition) == [
        (["board", "lanes"], "invalid_value"),
        (["mana", "start"], "mana_start_above_max"),
        (["setup", 0], "setup_phase_not_allowed"),
        (["turn", 0, "params", "count"], "invalid_params"),
        (["turn", 0, "params", "from"], "invalid_params"),
        (["turn", 1, "key"], "unknown_module"),
        (["turn"], "turn_needs_interactive_phase"),
        (["turn"], "end_turn_missing"),
    ]


def test_a_section_with_shape_errors_skips_its_other_checks() -> None:
    # The turn can't be parsed, so its pipeline rules can't run; the mana rule still does.
    definition = {"mana": {"start": 15}, "turn": [{"key": "end_turn", "params": []}]}

    assert errors_of(definition) == [
        (["turn", 0, "params"], "invalid_value"),
        (["mana", "start"], "mana_start_above_max"),
    ]


def test_a_phase_with_bad_params_still_counts_for_the_pipeline_rules() -> None:
    definition = {"turn": [{"key": "action_phase", "params": {"actor": "nobody"}}, END]}

    assert errors_of(definition) == [(["turn", 0, "params", "actor"], "invalid_params")]


def test_phases_may_repeat() -> None:
    definition = {"setup": [DRAW, DRAW], "turn": [DRAW, ACTION, DRAW, ACTION, END]}

    result, errors = validate_definition(definition)

    assert errors == []
    assert result is not None
    assert [phase.key for phase in result.turn] == [
        "draw",
        "action_phase",
        "draw",
        "action_phase",
        "end_turn",
    ]


def test_valid_definitions_come_back_normalized() -> None:
    result, errors = validate_definition({"setup": [], "turn": [ACTION, {"key": "end_turn"}]})

    assert errors == []
    assert result is not None
    assert result.model_dump(mode="json")["turn"] == [
        {
            "key": "action_phase",
            "params": {"actor": "active", "allow": ["play", "move", "attack"], "time_limit_s": 90},
        },
        {"key": "end_turn", "params": {}},
    ]
    assert result.model_dump(mode="json")["board"] == {
        "lanes": 3,
        "slots_per_section": 3,
        "section_hp": 20,
    }


def test_messages_are_plain_text() -> None:
    _, errors = validate_definition({"turn": [{"key": "nap"}]})

    assert all(error.message for error in errors)
    assert errors[0].message == "Unknown phase module 'nap'"
