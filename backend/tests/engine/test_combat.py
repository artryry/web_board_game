from app.engine.actions import Attack, CreatureRef, SectionRef
from app.engine.context import EngineContext
from app.engine.events import CreatureDied, SectionConquered
from app.engine.seats import Seat
from app.engine.state import CreatureInstance, GameState
from tests.engine.builders import (
    act,
    bare_rules,
    creature,
    filler_decks,
    new_game,
    origin,
    put_creature,
    ref,
)


def _hit_creature(
    state: GameState, attacker: CreatureInstance, defender: CreatureInstance
) -> GameState:
    state, _ = act(
        state,
        attacker.owner,
        Attack(creature_uid=attacker.uid, target=CreatureRef(uid=defender.uid)),
    )
    return state


def _hit_section(state: GameState, attacker: CreatureInstance, lane: int = 0) -> GameState:
    enemy: Seat = 1 if attacker.owner == 0 else 0
    target = SectionRef(seat=enemy, lane=lane)
    state, _ = act(state, attacker.owner, Attack(creature_uid=attacker.uid, target=target))
    return state


def _creature(state: GameState, uid: str) -> CreatureInstance | None:
    placed = EngineContext(state).find(uid)
    return None if placed is None else placed.creature


def test_creatures_hit_each_other_at_the_same_time() -> None:
    state = new_game()
    attacker = put_creature(state, 0, 0, 0, creature("A", hp=3, dmg=2))
    defender = put_creature(state, 1, 0, 0, creature("B", hp=4, dmg=1))

    state = _hit_creature(state, attacker, defender)

    hit_attacker, hit_defender = _creature(state, attacker.uid), _creature(state, defender.uid)
    assert hit_attacker is not None and hit_defender is not None
    assert (hit_attacker.hp, hit_defender.hp) == (2, 2)
    assert hit_attacker.exhausted


def test_both_fighters_can_die() -> None:
    state = new_game()
    attacker = put_creature(state, 0, 0, 0, creature("A", hp=2, dmg=2))
    defender = put_creature(state, 1, 0, 0, creature("B", hp=2, dmg=2))

    state, events = act(
        state, 0, Attack(creature_uid=attacker.uid, target=CreatureRef(uid=defender.uid))
    )

    died = [event.uid for event in events if isinstance(event, CreatureDied)]
    assert died == [attacker.uid, defender.uid]
    assert state.sections[0][0].slots[0] is None and state.sections[1][0].slots[0] is None


def test_armor_lowers_each_hit_never_below_zero() -> None:
    state = new_game()
    attacker = put_creature(state, 0, 0, 0, creature("A", hp=5, dmg=3))
    defender = put_creature(state, 1, 0, 0, creature("B", 5, 1, 1, ref("armor", amount=2)))
    shielded = put_creature(state, 0, 1, 0, creature("C", 5, 0, 1, ref("armor", amount=5)))

    state = _hit_creature(state, attacker, defender)

    hit = _creature(state, defender.uid)
    assert hit is not None and hit.hp == 4
    ctx = EngineContext(state)
    assert ctx.damage_creature(ctx.creature(shielded.uid), 3) == 0


def test_lifesteal_heals_the_own_section_attacking_and_defending() -> None:
    state = new_game()
    state.sections[0][0].hp = 10
    leech = creature("Leech", 5, 2, 1, ref("lifesteal_section"))
    attacker = put_creature(state, 0, 0, 0, leech)
    defender = put_creature(state, 1, 0, 0, creature("B", hp=9, dmg=1))

    state = _hit_creature(state, attacker, defender)
    assert state.sections[0][0].hp == 12

    state.sections[1][0].hp = 10
    defending_leech = put_creature(state, 1, 0, 1, leech)
    hitter = put_creature(state, 0, 0, 1, creature("C", hp=9, dmg=1))
    state = _hit_creature(state, hitter, defending_leech)
    assert state.sections[1][0].hp == 12


def test_lifesteal_doesnt_heal_a_conquered_section() -> None:
    state = new_game()
    state.sections[0][0].hp = 0
    state.sections[0][0].conquered = True
    attacker = put_creature(state, 0, 0, 0, creature("Leech", 5, 2, 1, ref("lifesteal_section")))
    defender = put_creature(state, 1, 0, 0, creature("B", hp=9, dmg=1))

    state = _hit_creature(state, attacker, defender)

    assert state.sections[0][0].hp == 0


def test_a_section_at_zero_is_conquered_and_extra_damage_is_lost() -> None:
    state = new_game()
    state.sections[1][0].hp = 3
    attacker = put_creature(state, 0, 0, 0, creature("A", hp=5, dmg=7))

    state, events = act(
        state, 0, Attack(creature_uid=attacker.uid, target=SectionRef(seat=1, lane=0))
    )

    section = state.sections[1][0]
    assert (section.hp, section.conquered) == (0, True)
    assert SectionConquered(seat=1, lane=0) in events


def test_a_conquered_section_cant_be_damaged_or_healed() -> None:
    state = new_game()
    ctx = EngineContext(state)
    section = ctx.section(1, 0)
    section.hp = 0
    section.conquered = True

    assert ctx.damage_section(section, 5) == 0
    assert ctx.heal_section(section, 5) == 0
    assert section.hp == 0


def test_attacker_penalty_hurts_the_attacker_and_softens_its_hit() -> None:
    penalty = origin("thorns", ref("attacker_penalty", hp=1, dmg=2))
    state = new_game(bare_rules(), filler_decks(origin1=penalty))
    armored = creature("A", 3, 3, 1, ref("armor", amount=3))
    attacker = put_creature(state, 0, 0, 0, armored)

    state = _hit_section(state, attacker)

    hit = _creature(state, attacker.uid)
    assert hit is not None and hit.hp == 2  # armor doesn't help against it
    assert state.sections[1][0].hp == 19


def test_attacker_penalty_can_kill_the_attacker() -> None:
    penalty = origin("thorns", ref("attacker_penalty", hp=2, dmg=0))
    state = new_game(bare_rules(), filler_decks(origin1=penalty))
    attacker = put_creature(state, 0, 0, 0, creature("A", hp=2, dmg=4))

    state = _hit_section(state, attacker)

    assert state.sections[0][0].slots[0] is None
    assert state.sections[1][0].hp == 16


def test_attacker_penalty_doesnt_apply_to_attacks_on_creatures() -> None:
    penalty = origin("thorns", ref("attacker_penalty", hp=2, dmg=2))
    state = new_game(bare_rules(), filler_decks(origin1=penalty))
    attacker = put_creature(state, 0, 0, 0, creature("A", hp=5, dmg=3))
    defender = put_creature(state, 1, 0, 0, creature("B", hp=5, dmg=1))

    state = _hit_creature(state, attacker, defender)

    hit_attacker, hit_defender = _creature(state, attacker.uid), _creature(state, defender.uid)
    assert hit_attacker is not None and hit_defender is not None
    assert (hit_attacker.hp, hit_defender.hp) == (4, 2)


def test_deathrattle_damages_the_enemy_section_in_its_lane() -> None:
    state = new_game()
    attacker = put_creature(state, 0, 1, 0, creature("A", hp=5, dmg=3))
    martyr = put_creature(
        state, 1, 1, 0, creature("M", 1, 0, 1, ref("deathrattle_damage", amount=4))
    )

    state = _hit_creature(state, attacker, martyr)

    assert state.sections[0][1].hp == 16
    assert [section.hp for section in state.sections[0]] == [20, 16, 20]
