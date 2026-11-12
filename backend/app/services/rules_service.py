"""Checks a ruleset definition and reports every problem at once, each with a path into the
definition, so the rules editor can show it next to its field (backend_plan §6).

The validate endpoint and the ruleset saves both go through `validate_definition`.
"""

from collections.abc import Mapping, Sequence
from typing import Any

from pydantic import ValidationError
from pydantic_core import ErrorDetails

from app.engine.registry import (
    InvalidParamsError,
    ModuleRef,
    PhaseModule,
    UnknownModuleError,
    registry,
)
from app.schemas.rules import (
    CURRENT_SCHEMA_VERSION,
    ManaRules,
    RuleError,
    RulesetDefinition,
    migrate,
)
from app.services.common import normalize_module_refs

END_TURN_KEY = "end_turn"

# A phase of a pipeline, with its index there.
_IndexedPhase = tuple[int, type[PhaseModule]]


def validate_definition(
    raw: Mapping[str, Any],
) -> tuple[RulesetDefinition | None, list[RuleError]]:
    """The definition with its phase params normalized (defaults filled in), or None and every
    problem found."""
    version = raw.get("schema_version", CURRENT_SCHEMA_VERSION)
    # Other types are left to pydantic, which reports them as invalid values.
    if isinstance(version, int) and version != CURRENT_SCHEMA_VERSION:
        # The rest can't be read under a format we don't know, so this is the only error.
        message = f"Unsupported schema version {version}; the only version is 1"
        return None, [
            RuleError(path=["schema_version"], code="unsupported_schema_version", message=message)
        ]

    definition, errors = _parse(migrate(raw))
    broken = {error.path[0] for error in errors}
    if "mana" not in broken:
        errors += _mana_errors(definition.mana)
    if "setup" not in broken:
        errors += _setup_errors(definition.setup)
    if "turn" not in broken:
        errors += _turn_errors(definition.turn)
    if errors:
        return None, errors

    normalized = definition.model_dump() | {
        "setup": normalize_module_refs(PhaseModule, definition.setup),
        "turn": normalize_module_refs(PhaseModule, definition.turn),
    }
    return RulesetDefinition.model_validate(normalized), []


def _parse(raw: dict[str, Any]) -> tuple[RulesetDefinition, list[RuleError]]:
    """The parsed definition, and the shape and bound errors pydantic found.

    A section with errors is parsed as its default instead, so the checks that need parsed
    values still run on the sound sections and every error shows at once. The caller skips the
    checks of the broken sections.
    """
    try:
        return RulesetDefinition.model_validate(raw), []
    except ValidationError as exc:
        errors = [_value_error(item) for item in exc.errors()]
    broken = {error.path[0] for error in errors}
    sound = {key: value for key, value in raw.items() if key not in broken}
    return RulesetDefinition.model_validate(sound), errors


def _value_error(item: ErrorDetails) -> RuleError:
    return RuleError(path=list(item["loc"]), code="invalid_value", message=item["msg"])


def _mana_errors(mana: ManaRules) -> list[RuleError]:
    if mana.start <= mana.max:
        return []
    message = f"Must be at most mana.max ({mana.max})"
    return [RuleError(path=["mana", "start"], code="mana_start_above_max", message=message)]


def _resolve_phases(
    pipeline: str, phases: Sequence[ModuleRef]
) -> tuple[list[_IndexedPhase], list[RuleError]]:
    """The phases whose key is known, and the key and params errors.

    A phase with bad params still counts as known, so the pipeline rules can check it.
    """
    known: list[_IndexedPhase] = []
    errors: list[RuleError] = []
    for index, phase in enumerate(phases):
        try:
            module = registry.get(PhaseModule, phase.key)
        except UnknownModuleError as exc:
            path: list[str | int] = [pipeline, index, "key"]
            errors.append(RuleError(path=path, code="unknown_module", message=exc.message))
            continue
        known.append((index, module))
        try:
            registry.validate_params(PhaseModule, phase.key, phase.params)
        except InvalidParamsError as exc:
            errors += [
                RuleError(
                    path=[pipeline, index, "params", *item["loc"]],
                    code="invalid_params",
                    message=item["msg"],
                )
                for item in exc.errors
            ]
    return known, errors


def _setup_errors(phases: Sequence[ModuleRef]) -> list[RuleError]:
    known, errors = _resolve_phases("setup", phases)
    for index, module in known:
        if module.interactive or module.key == END_TURN_KEY:
            errors.append(
                RuleError(
                    path=["setup", index],
                    code="setup_phase_not_allowed",
                    message=f"'{module.key}' can't be in setup, which runs once and waits for "
                    "no one",
                )
            )
    return errors


def _turn_errors(phases: Sequence[ModuleRef]) -> list[RuleError]:
    known, errors = _resolve_phases("turn", phases)
    if not any(module.interactive for _, module in known):
        errors.append(
            RuleError(
                path=["turn"],
                code="turn_needs_interactive_phase",
                message="A turn needs a phase where players act, such as 'action_phase'",
            )
        )
    errors += _end_turn_errors(
        len(phases), [i for i, module in known if module.key == END_TURN_KEY]
    )
    return errors


def _end_turn_errors(phase_count: int, end_turns: list[int]) -> list[RuleError]:
    """Exactly one end_turn, last. The one kept is the last phase if that is an end_turn, or else
    the first end_turn; every other one is a repeat."""
    if not end_turns:
        message = "A turn must end with 'end_turn'"
        return [RuleError(path=["turn"], code="end_turn_missing", message=message)]
    last = phase_count - 1
    kept = last if last in end_turns else end_turns[0]
    errors = []
    for index in end_turns:
        if index != kept:
            message = "A turn has only one 'end_turn'"
            errors.append(
                RuleError(path=["turn", index], code="end_turn_repeated", message=message)
            )
        elif index != last:
            message = "'end_turn' must be the last phase"
            errors.append(
                RuleError(path=["turn", index], code="end_turn_not_last", message=message)
            )
    return errors
