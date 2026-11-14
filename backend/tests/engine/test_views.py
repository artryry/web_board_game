from app.engine.events import CardDrawn, Event, events_for
from app.engine.runner import start_game, view_for
from app.engine.state import GameState
from app.engine.views import PlayerView
from app.schemas.rules import RulesetDefinition
from tests.engine.builders import (
    bare_rules,
    creature,
    deck,
    filler_decks,
    give_card,
    new_game,
    origin,
    put_creature,
    ref,
    spell,
)


def _started() -> tuple[GameState, list[Event]]:
    cards = [creature(f"C{n}", 1, 1, 1) for n in range(8)]
    return start_game(
        RulesetDefinition(), (deck(origin(), cards), deck(origin("volcano"), cards)), 4
    )


def test_a_player_sees_their_own_hand_and_only_counts_of_the_rest() -> None:
    state, _ = _started()

    view = view_for(state, 1)
    own, opponent = view.players[1], view.players[0]

    assert own.hand is not None
    assert [card.uid for card in own.hand] == [card.uid for card in state.players[1].hand]
    assert (opponent.hand, opponent.hand_count) == (None, 4)
    assert (own.deck_count, opponent.deck_count) == (4, 4)
    dumped = view.model_dump_json()
    for card in [*state.players[0].hand, *state.players[0].deck, *state.players[1].deck]:
        assert card.uid not in dumped


def test_the_own_hand_shows_the_cost_after_discounts() -> None:
    cheap = origin("arcane", ref("mana_discount", card_kind="spell", amount=2))
    state = new_game(bare_rules(), filler_decks(origin0=cheap))
    give_card(state, 0, spell("draw_cards", cost=3))
    give_card(state, 0, creature(cost=3))

    hand = view_for(state, 0).players[0].hand

    assert hand is not None and [card.cost for card in hand] == [1, 3]


def test_the_view_shows_the_phase_the_board_and_the_turn() -> None:
    state = new_game()
    wolf = put_creature(state, 1, 2, 1, creature())

    view = view_for(state, 0)

    assert view.phase.model_dump() == {
        "pipeline": "turn",
        "index": 1,
        "key": "action_phase",
        "interactive": True,
        "actor": "active",
        "allow": ["play", "move", "attack"],
        "time_limit_s": 90,
    }
    assert (view.seat, view.turn_number, view.active_seat, view.status) == (0, 1, 0, "playing")
    slot = view.sections[1][2].slots[1]
    assert slot is not None and slot.uid == wolf.uid
    assert PlayerView.model_validate_json(view.model_dump_json()) == view


def test_events_hide_the_other_player_s_drawn_cards() -> None:
    _, events = _started()

    for_seat_1 = events_for(events, 1)

    drawn = [event for event in for_seat_1 if isinstance(event, CardDrawn)]
    assert all(event.card is None for event in drawn if event.seat == 0)
    assert all(event.card is not None for event in drawn if event.seat == 1)
    assert len(for_seat_1) == len(events)
    assert [e for e in for_seat_1 if not isinstance(e, CardDrawn)] == [
        e for e in events if not isinstance(e, CardDrawn)
    ]
