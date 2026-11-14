"""Full games on boards of 1, 3 and 5 lanes reach game_over (backend_plan §12)."""

import pytest

from app.engine.runner import start_game
from tests.engine.builders import play_out
from tests.engine.scenarios import board_rules, decks


@pytest.mark.parametrize("lanes", [1, 3, 5])
@pytest.mark.parametrize("seed", [1, 2])
def test_a_full_game_reaches_game_over(lanes: int, seed: int) -> None:
    state, _ = start_game(board_rules(lanes), decks(20), seed)

    state, log = play_out(state)

    assert state.status == "finished"
    assert state.end_reason in ("conquered", "out_of_cards")
    assert len(state.sections[0]) == lanes
    assert log
