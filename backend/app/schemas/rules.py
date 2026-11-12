"""The rules JSON of a ruleset (backend_plan §6): board, deck, mana and hand settings, plus the
setup and turn pipelines of phase modules.

Pydantic checks the shape and the bounds here. The checks that need the module registry (phase
keys, params and the pipeline rules) and the cross-field one live in
`app.services.rules_service.validate_definition`, which reports every problem as a `RuleError`.
"""

from collections.abc import Mapping
from typing import Annotated, Any, Final, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.engine.registry import ModuleRef

CURRENT_SCHEMA_VERSION: Final = 1


class _Section(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BoardRules(_Section):
    lanes: Annotated[int, Field(ge=1, le=5)] = 3
    slots_per_section: Annotated[int, Field(ge=1, le=5)] = 3
    section_hp: Annotated[int, Field(ge=1, le=100)] = 20


class DeckRules(_Section):
    # The exact number of cards a deck needs to be picked for a room (M6). Unfinished decks can
    # still be saved.
    size: Annotated[int, Field(ge=10, le=60)] = 30
    max_copies: Annotated[int, Field(ge=1, le=4)] = 2
    # False stops neutral cards from being mixed into a deck of another origin. A neutral deck's
    # cards are its own origin, so a neutral deck still passes.
    allow_neutral: bool = True


class ManaRules(_Section):
    # At most `max`; rules_service checks it, so the error can point at `start`.
    start: Annotated[int, Field(ge=0, le=20)] = 1
    per_turn: Annotated[int, Field(ge=1, le=5)] = 1
    max: Annotated[int, Field(ge=1, le=20)] = 10


class HandRules(_Section):
    max_size: Annotated[int, Field(ge=1, le=15)] = 10
    second_player_bonus_card: bool = True


SetupPipeline = Annotated[list[ModuleRef], Field(max_length=5)]
TurnPipeline = Annotated[list[ModuleRef], Field(min_length=1, max_length=12)]


# The default pipelines are written normalized (every param filled in), so `RulesetDefinition()`
# equals what validation stores and what the seed migration inserts.
def _default_setup() -> list[ModuleRef]:
    return [ModuleRef(key="draw", params={"count": 3})]


def _default_turn() -> list[ModuleRef]:
    return [
        ModuleRef(key="gain_mana"),
        ModuleRef(key="draw", params={"count": 1}),
        ModuleRef(
            key="action_phase",
            params={"actor": "active", "allow": ["play", "move", "attack"], "time_limit_s": 90},
        ),
        ModuleRef(key="end_turn"),
    ]


class RulesetDefinition(BaseModel):
    """A ruleset's rules. Every value has a default, so `RulesetDefinition()` is the default
    ruleset."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = CURRENT_SCHEMA_VERSION
    board: BoardRules = Field(default_factory=BoardRules)
    deck: DeckRules = Field(default_factory=DeckRules)
    mana: ManaRules = Field(default_factory=ManaRules)
    hand: HandRules = Field(default_factory=HandRules)
    # Runs once before the first turn and waits for no one: no interactive phase, no end_turn.
    # The starting hand is whatever it draws.
    setup: SetupPipeline = Field(default_factory=_default_setup)
    # At least one interactive phase, and exactly one end_turn, last. Phases may repeat.
    turn: TurnPipeline = Field(default_factory=_default_turn)


RuleErrorCode = Literal[
    "invalid_value",
    "unknown_module",
    "invalid_params",
    "turn_needs_interactive_phase",
    "end_turn_missing",
    "end_turn_repeated",
    "end_turn_not_last",
    "setup_phase_not_allowed",
    "mana_start_above_max",
    "unsupported_schema_version",
]


class RuleError(BaseModel):
    """One problem in a definition. `path` points into it: at a value (`["board", "lanes"]`),
    or at a pipeline (`["turn"]`) for a rule about the whole pipeline."""

    path: list[str | int]
    code: RuleErrorCode
    message: str


def migrate(definition: Mapping[str, Any]) -> dict[str, Any]:
    """Upgrades a definition written for an older `schema_version` to the current one. Version 1
    is the only one so far, so this returns a copy unchanged; version 2 adds its upgrade here."""
    return dict(definition)
