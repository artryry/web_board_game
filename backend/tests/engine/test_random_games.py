"""Random games with fixed seeds (backend_plan §12): every action `legal_actions` offers is
accepted; changed actions are refused exactly when they aren't legal, and leave the state as it
was; `apply_action` never changes its input; and the state survives JSON."""

import random

import pytest

from app.engine.actions import (
    Action,
    Attack,
    CreatureRef,
    IllegalAction,
    Move,
    PlayCard,
    SectionRef,
    SlotRef,
    Surrender,
)
from app.engine.legality import legal_actions
from app.engine.runner import apply_action, start_game
from app.engine.seats import SEATS, Seat, other
from app.engine.state import GameState
from app.schemas.rules import RulesetDefinition
from tests.engine.scenarios import (
    ARCANE,
    FOREST,
    MOUNTAIN,
    OCEAN,
    RESTORE_BOTH_RULES,
    VOLCANO,
    board_rules,
    decks,
)

SEEDS = range(24)
MAX_STEPS = 250
RULESETS: list[RulesetDefinition] = [
    RulesetDefinition(),
    RESTORE_BOTH_RULES,
    board_rules(1),
    board_rules(5),
]
ORIGINS = [FOREST, VOLCANO, OCEAN, MOUNTAIN, ARCANE]


def _uids(state: GameState) -> list[str]:
    cards = [card.uid for player in state.players for card in [*player.hand, *player.deck]]
    creatures = [c.uid for row in state.sections for s in row for c in s.slots if c is not None]
    return [*cards, *creatures, "nope"]


def _random_slot(rnd: random.Random, state: GameState) -> SlotRef:
    board = state.ruleset.board
    return SlotRef(
        seat=rnd.choice(SEATS),
        lane=rnd.randrange(board.lanes + 1),
        slot=rnd.randrange(board.slots_per_section + 1),
    )


def _changed(rnd: random.Random, state: GameState, action: Action) -> Action:
    """The action with one part swapped for something random, often illegal."""
    uid = rnd.choice(_uids(state))
    match action:
        case PlayCard():
            if rnd.random() < 0.5:
                return action.model_copy(update={"card_uid": uid})
            return action.model_copy(update={"target": _random_slot(rnd, state)})
        case Move():
            if rnd.random() < 0.5:
                return action.model_copy(update={"creature_uid": uid})
            return action.model_copy(update={"to": _random_slot(rnd, state)})
        case Attack():
            target = rnd.choice(
                [CreatureRef(uid=uid), SectionRef(seat=rnd.choice(SEATS), lane=rnd.randrange(5))]
            )
            return action.model_copy(update={"target": target})
        case _:
            return action


def _check_changed_actions(rnd: random.Random, state: GameState, legal: list[Action]) -> None:
    before = state.model_dump()
    for action in rnd.sample(legal, min(3, len(legal))):
        seat: Seat = rnd.choice(SEATS)
        changed = _changed(rnd, state, action)
        if changed in legal_actions(state, seat):
            apply_action(state, seat, changed)
        else:
            with pytest.raises(IllegalAction):
                apply_action(state, seat, changed)
    assert state.model_dump() == before


@pytest.mark.parametrize("seed", SEEDS)
def test_a_random_game_keeps_the_engine_contract(seed: int) -> None:
    rnd = random.Random(seed)
    ruleset = RULESETS[seed % len(RULESETS)]
    first, second = rnd.sample(ORIGINS, 2)
    state, _ = start_game(ruleset, decks(16, first, second), seed)

    for step in range(MAX_STEPS):
        if state.status == "finished":
            break
        seat = rnd.choice(
            [
                s
                for s in (state.active_seat, other(state.active_seat))
                if len(legal_actions(state, s)) > 1
            ]
        )
        legal = [action for action in legal_actions(state, seat) if action != Surrender()]
        _check_changed_actions(rnd, state, legal)
        before = state.model_dump()

        new_state, _ = apply_action(state, seat, rnd.choice(legal))

        assert state.model_dump() == before
        assert new_state.version == state.version + 1
        state = new_state
        if step % 20 == 0:
            assert GameState.model_validate_json(state.model_dump_json()) == state

    assert GameState.model_validate_json(state.model_dump_json()) == state
