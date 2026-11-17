"""`Abandon`: the server's action for a player who stayed away from a game too long (M6)."""

import pytest
from pydantic import ValidationError

from app.engine.actions import (
    Abandon,
    EndPhase,
    IllegalAction,
    action_adapter,
    player_action_adapter,
)
from app.engine.events import GameOver
from app.engine.legality import legal_actions
from app.engine.runner import replay, view_for
from app.engine.seats import Seat, other
from tests.engine.builders import act, filler_decks, greedy_action, new_game, pass_turn
from tests.engine.scenarios import RESTORE_BOTH_RULES


@pytest.mark.parametrize("seat", [0, 1])
def test_abandon_ends_the_game_for_the_other_seat(seat: Seat) -> None:
    # Seat 0 is active, so seat 1 is abandoned outside its own turn.
    state = new_game()

    state, events = act(state, seat, Abandon())

    winner = other(seat)
    assert (state.status, state.winner, state.end_reason) == ("finished", winner, "abandoned")
    assert events == [GameOver(winner=winner, end_reason="abandoned")]
    view = view_for(state, winner)
    assert (view.status, view.winner, view.end_reason) == ("finished", winner, "abandoned")


def test_abandon_works_in_an_actor_both_phase_after_the_player_is_ready() -> None:
    state = new_game(RESTORE_BOTH_RULES)
    state, _ = act(state, 1, EndPhase())

    state, _ = act(state, 1, Abandon())

    assert (state.winner, state.end_reason) == (0, "abandoned")


def test_abandon_is_refused_once_the_game_is_over() -> None:
    state, _ = act(new_game(), 0, Abandon())

    with pytest.raises(IllegalAction) as exc_info:
        act(state, 1, Abandon())
    assert exc_info.value.reason == "game_over"


def test_abandon_is_never_a_legal_action() -> None:
    state = new_game()
    for _ in range(3):
        for seat in (0, 1):
            assert Abandon() not in legal_actions(state, seat)
        state = pass_turn(state)


def test_players_cant_send_abandon() -> None:
    assert action_adapter.validate_python({"type": "abandon"}) == Abandon()
    assert player_action_adapter.validate_python({"type": "end_phase"}) == EndPhase()
    with pytest.raises(ValidationError):
        player_action_adapter.validate_python({"type": "abandon"})


def test_a_replay_with_abandon_in_its_log_ends_the_same_way() -> None:
    state = new_game(seed=5)
    for _ in range(4):
        state, _ = act(state, state.active_seat, greedy_action(state, state.active_seat))
    state, _ = act(state, 0, Abandon())

    states = replay(state.ruleset, filler_decks(), 5, state.log)

    assert states[-1].model_dump() == state.model_dump()
    assert state.log[-1].action == Abandon()
