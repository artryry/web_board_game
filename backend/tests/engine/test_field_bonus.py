"""Field bonuses follow the section a creature stands in: counted on summon and move, lost on
conquest, and losing one never kills."""

from app.engine.actions import Move, SlotRef
from app.engine.context import EngineContext
from app.engine.events import Event, StatsChanged
from app.engine.state import CreatureInstance, GameState
from tests.engine.builders import (
    NEUTRAL,
    act,
    bare_rules,
    creature,
    creature_at,
    filler_decks,
    new_game,
    origin,
    put_creature,
    ref,
)

FOREST_HP = origin("forest", ref("stat_bonus", applies_to="own_origin", hp=1, dmg=1))


def _game() -> GameState:
    return new_game(bare_rules(), filler_decks(origin0=FOREST_HP))


def _stats(creature: CreatureInstance) -> tuple[int, int, int]:
    return creature.hp, creature.max_hp, creature.dmg


def test_stat_bonus_counts_on_summon_for_the_own_origin_only() -> None:
    state = _game()

    forest = put_creature(state, 0, 0, 0, creature("Elk", 2, 1))
    neutral = put_creature(state, 0, 0, 1, creature("Rat", 2, 1, origin_id=NEUTRAL))

    assert _stats(forest) == (3, 3, 2)
    assert _stats(neutral) == (2, 2, 1)


def test_all_own_counts_for_every_creature_of_the_owner() -> None:
    everyone = origin("forest", ref("stat_bonus", applies_to="all_own", hp=2, dmg=0))
    state = new_game(bare_rules(), filler_decks(origin0=everyone))

    neutral = put_creature(state, 0, 0, 0, creature("Rat", 2, 1, origin_id=NEUTRAL))
    enemy = put_creature(state, 1, 0, 0, creature("Imp", 2, 1))

    assert _stats(neutral) == (4, 4, 1)
    assert _stats(enemy) == (2, 2, 1)


def test_field_affinity_counts_when_the_card_matches_the_deck_origin() -> None:
    state = new_game()
    affine = ref("field_affinity", bonus=2)

    matching = put_creature(state, 0, 0, 0, creature("Elk", 2, 1, 1, affine))
    neutral = put_creature(state, 0, 0, 1, creature("Rat", 2, 1, 1, affine, origin_id=NEUTRAL))

    assert _stats(matching) == (4, 4, 3)
    assert _stats(neutral) == (2, 2, 1)


def _conquer(state: GameState, lane: int) -> list[Event]:
    """Conquers one of seat 0's sections through the primitive that attacks and spells use. (No
    attack can reach it here: the creatures standing in it block the way.)"""
    ctx = EngineContext(state)
    ctx.damage_section(ctx.section(0, lane), 99)
    return ctx.events


def test_a_conquest_takes_the_bonus_back() -> None:
    state = _game()
    elk = put_creature(state, 0, 0, 0, creature("Elk", 2, 1))

    events = _conquer(state, 0)

    assert _stats(elk) == (2, 2, 1)
    assert StatsChanged(uid=elk.uid, hp=2, max_hp=2, dmg=1) in events


def test_losing_the_bonus_lowers_hp_only_down_to_the_new_maximum_and_never_kills() -> None:
    state = _game()
    hurt = put_creature(state, 0, 0, 0, creature("Elk", 2, 1))
    hurt.hp = 1  # 1 of 3
    healthy = put_creature(state, 0, 0, 1, creature("Elk", 2, 1))

    _conquer(state, 0)

    assert _stats(hurt) == (1, 2, 1)
    assert _stats(healthy) == (2, 2, 1)


def test_moving_into_a_conquered_section_loses_the_bonus_and_moving_out_regains_it() -> None:
    state = _game()
    state.sections[0][1].hp = 0
    state.sections[0][1].conquered = True
    elk = put_creature(state, 0, 0, 0, creature("Elk", 2, 1))

    state, events = act(state, 0, Move(creature_uid=elk.uid, to=SlotRef(seat=0, lane=1, slot=0)))
    assert _stats(creature_at(state, 0, 1, 0)) == (2, 2, 1)
    assert StatsChanged(uid=elk.uid, hp=2, max_hp=2, dmg=1) in events

    creature_at(state, 0, 1, 0).exhausted = False
    creature_at(state, 0, 1, 0).has_moved = False
    state, _ = act(state, 0, Move(creature_uid=elk.uid, to=SlotRef(seat=0, lane=2, slot=0)))
    assert _stats(creature_at(state, 0, 2, 0)) == (3, 3, 2)


def test_a_creature_summoned_into_a_conquered_section_gets_no_bonus() -> None:
    state = _game()
    state.sections[0][0].hp = 0
    state.sections[0][0].conquered = True

    elk = put_creature(state, 0, 0, 0, creature("Elk", 2, 1))

    assert _stats(elk) == (2, 2, 1)
