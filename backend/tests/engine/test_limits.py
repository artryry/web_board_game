import pytest

from app.engine import context
from app.engine.actions import EndPhase, IllegalAction, PlayCard
from app.engine.context import EngineContext, EngineLimitError
from app.engine.runner import apply_action
from tests.engine.builders import give_card, new_game, set_mana, spell


def test_too_many_steps_reject_the_action_and_keep_the_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = new_game()
    before = state.model_dump()
    monkeypatch.setattr(context, "MAX_STEPS", 2)

    with pytest.raises(IllegalAction) as exc_info:
        apply_action(state, 0, EndPhase())

    assert exc_info.value.reason == "engine_limit"
    assert state.model_dump() == before


def test_a_trigger_chain_too_deep_rejects_the_action(monkeypatch: pytest.MonkeyPatch) -> None:
    state = new_game()
    set_mana(state, 0, 5)
    study = give_card(state, 0, spell("draw_cards", count=1))
    monkeypatch.setattr(context, "MAX_DEPTH", 0)

    with pytest.raises(IllegalAction) as exc_info:
        apply_action(state, 0, PlayCard(card_uid=study, target=None))

    assert exc_info.value.reason == "engine_limit"
    assert [card.uid for card in state.players[0].hand] == [study]


def test_triggers_count_their_depth(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(context, "MAX_DEPTH", 2)
    ctx = EngineContext(new_game())

    with ctx.trigger(), ctx.trigger():
        with pytest.raises(EngineLimitError), ctx.trigger():
            pass
    with ctx.trigger(), ctx.trigger():
        pass  # the depth went back down
