import pytest

from app.engine.actions import (
    Attack,
    CreatureRef,
    EndPhase,
    IllegalAction,
    SectionRef,
    Surrender,
)
from app.engine.events import CardDiscarded, CardDrawn, DeckEmpty, GameOver, PlayerReady
from app.engine.legality import legal_actions
from app.engine.runner import apply_action, start_game
from app.engine.snapshots import DeckSnapshot
from app.engine.state import GameState
from app.schemas.rules import RulesetDefinition
from tests.engine.builders import (
    act,
    bare_rules,
    creature,
    deck,
    filler_decks,
    new_game,
    origin,
    pass_turn,
    put_creature,
    ref,
    rules,
)


def _numbered_decks(size: int = 10) -> tuple[DeckSnapshot, DeckSnapshot]:
    cards = [creature(f"C{n}", 1, 1, 1) for n in range(size)]
    return deck(origin(), cards), deck(origin("volcano"), cards)


def test_setup_draws_for_both_seats_seat_0_first_then_the_bonus_card() -> None:
    state, events = start_game(RulesetDefinition(), _numbered_decks(), seed=3)

    drawn = [event.seat for event in events if isinstance(event, CardDrawn)]
    # Setup: 3 for seat 0, 3 for seat 1; the bonus card; then seat 0's turn-1 draw.
    assert drawn == [0, 0, 0, 1, 1, 1, 1, 0]
    assert [len(player.hand) for player in state.players] == [4, 4]
    assert (state.turn_number, state.active_seat) == (1, 0)
    assert state.ruleset.turn[state.phase.index].key == "action_phase"


def test_no_bonus_card_when_the_rules_turn_it_off() -> None:
    state, _ = start_game(
        rules(hand={"second_player_bonus_card": False}), _numbered_decks(), seed=3
    )

    assert [len(player.hand) for player in state.players] == [4, 3]


def test_card_uids_follow_the_shuffled_deck() -> None:
    state, _ = start_game(RulesetDefinition(), _numbered_decks(), seed=3)

    assert [card.uid for card in state.players[0].hand] == ["p0-1", "p0-2", "p0-3", "p0-4"]
    assert state.players[0].deck[0].uid == "p0-5"


def test_the_same_seed_gives_the_same_game() -> None:
    first, first_events = start_game(RulesetDefinition(), _numbered_decks(), seed=11)
    again, again_events = start_game(RulesetDefinition(), _numbered_decks(), seed=11)
    other, _ = start_game(RulesetDefinition(), _numbered_decks(), seed=12)

    assert first == again
    assert first_events == again_events
    assert first.players[0].hand != other.players[0].hand


def test_ending_the_action_phase_passes_the_turn() -> None:
    state = new_game()

    state = pass_turn(state)

    assert (state.turn_number, state.active_seat) == (2, 1)
    assert state.ruleset.turn[state.phase.index].key == "action_phase"


def _mana_by_turn(state: GameState, turns: int) -> list[tuple[int, int]]:
    seen = []
    for _ in range(turns):
        player = state.players[state.active_seat]
        seen.append((player.mana, player.max_mana))
        state = pass_turn(state)
    return seen


def test_grow_mana_rises_to_the_cap_and_refills() -> None:
    state = new_game(bare_rules(mana={"start": 1, "per_turn": 1, "max": 3, "mode": "grow"}))
    state.players[0].mana = 0  # spent; grow refills it next turn anyway

    seat_0_turns = _mana_by_turn(state, 8)[::2]

    assert seat_0_turns == [(0, 1), (2, 2), (3, 3), (3, 3)]


def test_restore_mana_adds_per_turn_and_keeps_unspent_mana() -> None:
    state = new_game(bare_rules(mana={"start": 1, "per_turn": 2, "max": 5, "mode": "restore"}))

    seat_0_turns = _mana_by_turn(state, 8)[::2]

    assert seat_0_turns == [(1, 5), (3, 5), (5, 5), (5, 5)]


def test_both_players_act_in_an_actor_both_phase_until_both_are_ready() -> None:
    state = new_game(
        bare_rules(turn=[ref("gain_mana"), ref("action_phase", actor="both"), ref("end_turn")])
    )
    assert EndPhase() in legal_actions(state, 1)

    state, events = act(state, 0, EndPhase())

    assert events == [PlayerReady(seat=0)]
    assert state.ready == [True, False]
    assert legal_actions(state, 0) == [Surrender()]
    with pytest.raises(IllegalAction) as exc_info:
        act(state, 0, EndPhase())
    assert exc_info.value.reason == "not_allowed_now"

    state, _ = act(state, 1, EndPhase())

    assert (state.turn_number, state.active_seat) == (2, 1)
    assert state.ready == [False, False]


def test_the_hand_limit_phase_discards_the_newest_cards() -> None:
    turn = [
        ref("draw", count=3),
        ref("discard_to_hand_limit"),
        ref("action_phase"),
        ref("end_turn"),
    ]
    state, events = start_game(
        bare_rules(hand={"max_size": 2, "second_player_bonus_card": False}, turn=turn),
        _numbered_decks(),
        seed=3,
    )

    assert [card.uid for card in state.players[0].hand] == ["p0-1", "p0-2"]
    discarded = [event for event in events if isinstance(event, CardDiscarded)]
    assert [event.card.uid for event in discarded if event.card] == ["p0-3"]


def test_without_the_hand_limit_phase_a_hand_has_no_limit() -> None:
    state, _ = start_game(rules(hand={"max_size": 1}), _numbered_decks(), seed=3)

    assert len(state.players[0].hand) == 4


def test_a_draw_from_an_empty_deck_draws_nothing() -> None:
    decks = (deck(origin(), []), filler_decks()[1])
    state, events = start_game(rules(), decks, seed=1)

    assert state.players[0].hand == []
    assert DeckEmpty(seat=0) in events
    assert state.status == "playing"


def test_surrender_ends_the_game_for_the_other_seat() -> None:
    state = new_game()

    state, events = act(state, 1, Surrender())

    assert (state.status, state.winner, state.end_reason) == ("finished", 0, "surrender")
    assert events == [GameOver(winner=0, end_reason="surrender")]
    assert legal_actions(state, 0) == []
    with pytest.raises(IllegalAction) as exc_info:
        act(state, 0, EndPhase())
    assert exc_info.value.reason == "game_over"


def test_conquering_every_section_wins() -> None:
    state = new_game(bare_rules(board={"lanes": 1}))
    attacker = put_creature(state, 0, 0, 0, creature("Brute", 5, 30))

    state, events = act(
        state, 0, Attack(creature_uid=attacker.uid, target=SectionRef(seat=1, lane=0))
    )

    assert (state.status, state.winner, state.end_reason) == ("finished", 0, "conquered")
    assert events[-1] == GameOver(winner=0, end_reason="conquered")


def test_both_players_losing_their_last_section_at_once_is_a_draw() -> None:
    state = new_game(bare_rules(board={"lanes": 1}))
    for row in state.sections:
        row[0].hp = 1
    doomed = creature("Doomed", 1, 1, 1, ref("deathrattle_damage", amount=1))
    attacker = put_creature(state, 0, 0, 0, doomed)
    defender = put_creature(state, 1, 0, 0, doomed)

    state, _ = act(
        state, 0, Attack(creature_uid=attacker.uid, target=CreatureRef(uid=defender.uid))
    )

    assert [section.conquered for row in state.sections for section in row] == [True, True]
    assert (state.status, state.winner, state.end_reason) == ("finished", None, "conquered")


def _out_of_cards(state: GameState) -> GameState:
    for player in state.players:
        player.deck.clear()
        player.hand.clear()
    return state


def test_out_of_cards_the_player_with_more_sections_left_wins() -> None:
    state = _out_of_cards(new_game())
    state.sections[1][0].hp = 0
    state.sections[1][0].conquered = True

    state, events = act(state, 0, EndPhase())

    assert (state.status, state.winner, state.end_reason) == ("finished", 0, "out_of_cards")
    assert events[-1] == GameOver(winner=0, end_reason="out_of_cards")


def test_out_of_cards_with_the_same_sections_left_is_a_draw() -> None:
    state = _out_of_cards(new_game())

    state, _ = act(state, 0, EndPhase())

    assert (state.status, state.winner, state.end_reason) == ("finished", None, "out_of_cards")


def test_a_creature_on_the_board_keeps_the_game_going() -> None:
    state = _out_of_cards(new_game())
    put_creature(state, 1, 2, 2, creature())

    state, _ = act(state, 0, EndPhase())

    assert state.status == "playing"


def test_apply_action_returns_a_new_state_and_leaves_the_old_one() -> None:
    state = new_game()
    before = state.model_dump()

    new_state, _ = apply_action(state, 0, EndPhase())

    assert state.model_dump() == before
    assert new_state.version == state.version + 1
    assert [(entry.seat, entry.action) for entry in new_state.log] == [(0, EndPhase())]
