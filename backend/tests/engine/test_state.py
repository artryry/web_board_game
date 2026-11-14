from app.engine.runner import start_game
from app.engine.state import GameState
from app.schemas.rules import RulesetDefinition
from tests.engine.builders import (
    bare_rules,
    creature,
    deck,
    new_game,
    origin,
    play_out,
    put_creature,
    ref,
    spell,
)


def _played_game() -> GameState:
    cards = [creature("Wolf", 3, 2, 1, ref("armor")), spell("deal_damage", dmg=2)]
    decks = (deck(origin(), cards, 5), deck(origin("volcano"), cards, 5))
    state, _ = start_game(RulesetDefinition(), decks, seed=5)
    state, _ = play_out(state, max_actions=40)
    return state


def test_the_state_survives_a_json_round_trip() -> None:
    state = _played_game()

    restored = GameState.model_validate_json(state.model_dump_json())

    assert restored == state
    assert restored.log == state.log


def test_a_clone_can_change_without_touching_the_original() -> None:
    state = new_game(bare_rules())
    put_creature(state, 0, 0, 0, creature())
    before = state.model_dump()

    clone = state.clone()
    clone.players[0].mana = 9
    clone.players[0].hand.clear()
    clone.sections[0][0].hp = 1
    clone_creature = clone.sections[0][0].slots[0]
    assert clone_creature is not None
    clone_creature.hp = 99
    clone.sections[0][0].slots[1] = clone_creature
    clone.phase.index = 2
    clone.ready[0] = True

    assert state.model_dump() == before
