"""Golden replays (backend_plan §12): a ruleset, two decks, a seed and the actions must give the
stored final state.

The fixtures are rewritten by running the bot again: `UPDATE_GOLDEN=1 pytest tests/engine`.
Review the diff, since any change in it is a change in how games play.
"""

import os
from pathlib import Path

import pytest
from pydantic import BaseModel

from app.engine.runner import replay, start_game
from app.engine.snapshots import DeckSnapshot
from app.engine.state import GameState, LoggedAction
from app.schemas.rules import RulesetDefinition
from tests.engine.builders import deck, play_out
from tests.engine.scenarios import (
    ARCANE,
    FOREST,
    MOUNTAIN,
    OCEAN,
    ONE_LANE_CARDS,
    ONE_LANE_RULES,
    RESTORE_BOTH_RULES,
    VOLCANO,
    decks,
)

REPLAYS = Path(__file__).resolve().parents[1] / "fixtures" / "replays"
UPDATE = os.environ.get("UPDATE_GOLDEN") == "1"

SCENARIOS: dict[str, tuple[RulesetDefinition, tuple[DeckSnapshot, DeckSnapshot], int]] = {
    "default_rules": (RulesetDefinition(), decks(30, FOREST, VOLCANO), 2026),
    "restore_both": (RESTORE_BOTH_RULES, decks(30, OCEAN, MOUNTAIN), 7),
    "one_lane_ranged_taunt": (
        ONE_LANE_RULES,
        (deck(ARCANE, ONE_LANE_CARDS, 4), deck(MOUNTAIN, ONE_LANE_CARDS, 4)),
        3,
    ),
}


class GoldenReplay(BaseModel):
    ruleset: RulesetDefinition
    decks: tuple[DeckSnapshot, DeckSnapshot]
    seed: int
    actions: list[LoggedAction]
    final_state: GameState


def _record(name: str, path: Path) -> None:
    ruleset, game_decks, seed = SCENARIOS[name]
    state, _ = start_game(ruleset, game_decks, seed)
    state, log = play_out(state)
    assert state.status == "finished", f"the bot didn't finish '{name}'"
    golden = GoldenReplay(
        ruleset=ruleset, decks=game_decks, seed=seed, actions=log, final_state=state
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(golden.model_dump_json(indent=1) + "\n", encoding="utf-8")


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_a_golden_replay_gives_the_stored_final_state(name: str) -> None:
    path = REPLAYS / f"{name}.json"
    if UPDATE:
        _record(name, path)
    assert path.exists(), f"{path.name} is missing: run UPDATE_GOLDEN=1 pytest tests/engine"
    golden = GoldenReplay.model_validate_json(path.read_text(encoding="utf-8"))

    states = replay(golden.ruleset, golden.decks, golden.seed, golden.actions)

    assert len(states) == len(golden.actions) + 1
    assert states[-1].status == "finished"
    assert states[-1].model_dump() == golden.final_state.model_dump()
