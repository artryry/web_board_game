import pytest

from app.engine.actions import (
    Action,
    Attack,
    CreatureRef,
    EndPhase,
    IllegalAction,
    IllegalReason,
    Move,
    PlayCard,
    SectionRef,
    SlotRef,
    Surrender,
)
from app.engine.legality import legal_actions
from app.engine.seats import Seat
from app.engine.state import GameState
from tests.engine.builders import (
    act,
    bare_rules,
    creature,
    filler_decks,
    give_card,
    new_game,
    origin,
    put_creature,
    ref,
    set_mana,
    spell,
)

OCEAN = origin("ocean", ref("free_move"))


def _refused(state: GameState, seat: Seat, action: Action) -> IllegalReason:
    before = state.model_dump()
    with pytest.raises(IllegalAction) as exc_info:
        act(state, seat, action)
    assert state.model_dump() == before
    return exc_info.value.reason


def test_the_active_player_gets_every_action_and_the_other_only_surrender() -> None:
    state = new_game(bare_rules(board={"lanes": 1, "slots_per_section": 2}))
    wolf = give_card(state, 0, creature())
    set_mana(state, 0, 1)
    archer = put_creature(state, 0, 0, 0, creature("Archer"))

    assert legal_actions(state, 0) == [
        EndPhase(),
        PlayCard(card_uid=wolf, target=SlotRef(seat=0, lane=0, slot=1)),
        Move(creature_uid=archer.uid, to=SlotRef(seat=0, lane=0, slot=1)),
        Attack(creature_uid=archer.uid, target=SectionRef(seat=1, lane=0)),
        Surrender(),
    ]
    assert legal_actions(state, 1) == [Surrender()]


def test_not_your_turn() -> None:
    assert _refused(new_game(), 1, EndPhase()) == "not_your_turn"


def test_not_allowed_now_when_the_phase_forbids_the_kind() -> None:
    state = new_game(
        bare_rules(turn=[ref("gain_mana"), ref("action_phase", allow=["attack"]), ref("end_turn")])
    )
    wolf = give_card(state, 0, creature())

    assert _refused(state, 0, PlayCard(card_uid=wolf, target=SlotRef(seat=0, lane=0, slot=0))) == (
        "not_allowed_now"
    )
    assert not any(isinstance(action, PlayCard) for action in legal_actions(state, 0))


def test_unknown_card_and_creature() -> None:
    state = new_game()
    enemy = put_creature(state, 1, 0, 0, creature())
    slot = SlotRef(seat=0, lane=0, slot=0)

    assert _refused(state, 0, PlayCard(card_uid="nope", target=slot)) == "unknown_card"
    assert _refused(state, 0, Move(creature_uid=enemy.uid, to=slot)) == "unknown_card"
    assert _refused(state, 0, Attack(creature_uid="nope", target=SectionRef(seat=1, lane=0))) == (
        "unknown_card"
    )


def test_not_enough_mana() -> None:
    state = new_game()
    giant = give_card(state, 0, creature("Giant", 9, 9, 5))

    assert _refused(state, 0, PlayCard(card_uid=giant, target=SlotRef(seat=0, lane=0, slot=0))) == (
        "not_enough_mana"
    )


def test_slot_occupied_and_invalid_slots() -> None:
    state = new_game()
    wolf = give_card(state, 0, creature())
    put_creature(state, 0, 0, 0, creature())

    assert _refused(state, 0, PlayCard(card_uid=wolf, target=SlotRef(seat=0, lane=0, slot=0))) == (
        "slot_occupied"
    )
    for bad in (SlotRef(seat=1, lane=0, slot=0), SlotRef(seat=0, lane=7, slot=0), None):
        assert _refused(state, 0, PlayCard(card_uid=wolf, target=bad)) == "invalid_target"


def test_a_spell_target_must_be_one_it_offers() -> None:
    state = new_game()
    bolt = give_card(state, 0, spell("deal_damage", dmg=2))
    own = put_creature(state, 0, 0, 0, creature())

    assert _refused(state, 0, PlayCard(card_uid=bolt, target=CreatureRef(uid=own.uid))) == (
        "invalid_target"
    )


def test_an_attack_target_must_be_in_reach() -> None:
    state = new_game()
    attacker = put_creature(state, 0, 0, 0, creature())

    assert _refused(
        state, 0, Attack(creature_uid=attacker.uid, target=SectionRef(seat=1, lane=2))
    ) == ("invalid_target")


def test_a_creature_is_exhausted_on_the_turn_it_is_played_unless_it_has_charge() -> None:
    state = new_game()
    set_mana(state, 0, 2)
    wolf = give_card(state, 0, creature())
    rider = give_card(state, 0, creature("Rider", 1, 1, 1, ref("charge")))
    state, _ = act(state, 0, PlayCard(card_uid=wolf, target=SlotRef(seat=0, lane=0, slot=0)))
    state, _ = act(state, 0, PlayCard(card_uid=rider, target=SlotRef(seat=0, lane=1, slot=0)))

    assert _refused(state, 0, Attack(creature_uid=wolf, target=SectionRef(seat=1, lane=0))) == (
        "creature_exhausted"
    )
    assert _refused(state, 0, Move(creature_uid=wolf, to=SlotRef(seat=0, lane=2, slot=0))) == (
        "creature_exhausted"
    )
    state, _ = act(state, 0, Attack(creature_uid=rider, target=SectionRef(seat=1, lane=1)))
    assert state.sections[1][1].hp == 19


def test_without_free_move_a_move_uses_the_action() -> None:
    state = new_game()
    wolf = put_creature(state, 0, 0, 0, creature())

    state, _ = act(state, 0, Move(creature_uid=wolf.uid, to=SlotRef(seat=0, lane=1, slot=0)))

    assert _refused(state, 0, Attack(creature_uid=wolf.uid, target=SectionRef(seat=1, lane=1))) == (
        "creature_exhausted"
    )


def test_with_free_move_a_creature_moves_once_at_any_time() -> None:
    state = new_game(bare_rules(), filler_decks(origin0=OCEAN))
    set_mana(state, 0, 1)
    wolf = give_card(state, 0, creature())
    state, _ = act(state, 0, PlayCard(card_uid=wolf, target=SlotRef(seat=0, lane=0, slot=0)))

    # Just played, so it can't attack, but it can move.
    state, _ = act(state, 0, Move(creature_uid=wolf, to=SlotRef(seat=0, lane=1, slot=0)))
    assert _refused(state, 0, Move(creature_uid=wolf, to=SlotRef(seat=0, lane=2, slot=0))) == (
        "already_moved"
    )

    veteran = put_creature(state, 0, 2, 0, creature("Vet"))
    state, _ = act(state, 0, Attack(creature_uid=veteran.uid, target=SectionRef(seat=1, lane=2)))
    state, _ = act(state, 0, Move(creature_uid=veteran.uid, to=SlotRef(seat=0, lane=2, slot=1)))
    assert state.sections[0][2].slots[1] is not None


def test_mana_discount_makes_a_card_playable() -> None:
    cheap_spells = origin("arcane", ref("mana_discount", card_kind="spell", amount=2))
    state = new_game(bare_rules(), filler_decks(origin0=cheap_spells))
    set_mana(state, 0, 0)
    draw = give_card(state, 0, spell("draw_cards", cost=1, count=1))
    wolf = give_card(state, 0, creature())

    actions = legal_actions(state, 0)

    assert PlayCard(card_uid=draw, target=None) in actions
    assert not any(isinstance(a, PlayCard) and a.card_uid == wolf for a in actions)
    state, _ = act(state, 0, PlayCard(card_uid=draw, target=None))
    assert state.players[0].mana == 0


def test_surrender_is_always_legal_while_playing() -> None:
    state = new_game()

    assert Surrender() in legal_actions(state, 0)
    assert Surrender() in legal_actions(state, 1)
