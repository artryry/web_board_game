import pytest

from app.engine.actions import Attack, CreatureRef, SectionRef
from app.engine.context import EngineContext
from app.engine.legality import legal_actions
from app.engine.state import GameState
from app.engine.targets import attack_lanes, lane_combat_target
from tests.engine.builders import bare_rules, creature, new_game, put_creature, ref

RANGED = creature("Archer", 2, 1, 1, ref("ranged"))


def _attack_targets(state: GameState, uid: str) -> list[CreatureRef | SectionRef]:
    return [
        action.target
        for action in legal_actions(state, 0)
        if isinstance(action, Attack) and action.creature_uid == uid
    ]


def test_with_no_enemy_creatures_it_attacks_the_section() -> None:
    state = new_game()
    attacker = put_creature(state, 0, 1, 0, creature())

    assert _attack_targets(state, attacker.uid) == [SectionRef(seat=1, lane=1)]


def test_any_enemy_creature_in_the_lane_blocks_the_section() -> None:
    state = new_game()
    attacker = put_creature(state, 0, 1, 0, creature())
    first = put_creature(state, 1, 1, 0, creature())
    second = put_creature(state, 1, 1, 2, creature())
    put_creature(state, 1, 0, 0, creature())

    assert _attack_targets(state, attacker.uid) == [
        CreatureRef(uid=first.uid),
        CreatureRef(uid=second.uid),
    ]


def test_taunt_must_be_attacked_first() -> None:
    state = new_game()
    attacker = put_creature(state, 0, 1, 0, creature())
    put_creature(state, 1, 1, 0, creature())
    guard = put_creature(state, 1, 1, 1, creature("Guard", 3, 1, 1, ref("taunt")))

    assert _attack_targets(state, attacker.uid) == [CreatureRef(uid=guard.uid)]


def test_a_conquered_section_with_no_creatures_offers_no_target() -> None:
    state = new_game()
    state.sections[1][1].hp = 0
    state.sections[1][1].conquered = True
    attacker = put_creature(state, 0, 1, 0, creature())

    assert _attack_targets(state, attacker.uid) == []


@pytest.mark.parametrize(
    ("lanes", "lane", "expected"),
    [(1, 0, [0]), (3, 0, [0, 1]), (3, 1, [0, 1, 2]), (3, 2, [1, 2]), (5, 4, [3, 4])],
)
def test_ranged_reaches_the_neighbouring_lanes_on_the_board(
    lanes: int, lane: int, expected: list[int]
) -> None:
    state = new_game(bare_rules(board={"lanes": lanes}))
    archer = put_creature(state, 0, lane, 0, RANGED)

    assert attack_lanes(EngineContext(state), archer) == expected


def test_ranged_targets_each_lane_by_its_own_taunt() -> None:
    state = new_game()
    archer = put_creature(state, 0, 0, 0, RANGED)
    guard = put_creature(state, 1, 0, 0, creature("Guard", 3, 1, 1, ref("taunt")))

    assert _attack_targets(state, archer.uid) == [
        CreatureRef(uid=guard.uid),
        SectionRef(seat=1, lane=1),
    ]


def test_lane_combat_takes_the_own_lane_first() -> None:
    state = new_game()
    archer = put_creature(state, 0, 1, 0, RANGED)
    put_creature(state, 1, 0, 0, creature())

    target = lane_combat_target(EngineContext(state), archer)

    assert target == SectionRef(seat=1, lane=1)


def test_lane_combat_falls_back_to_the_lowest_neighbouring_lane() -> None:
    state = new_game()
    state.sections[1][1].hp = 0
    state.sections[1][1].conquered = True
    archer = put_creature(state, 0, 1, 0, RANGED)
    plain = put_creature(state, 0, 1, 1, creature())
    blocker = put_creature(state, 1, 2, 0, creature())

    ctx = EngineContext(state)
    assert lane_combat_target(ctx, archer) == SectionRef(seat=1, lane=0)
    assert lane_combat_target(ctx, plain) is None

    state.sections[1][0].hp = 0
    state.sections[1][0].conquered = True
    assert lane_combat_target(EngineContext(state), archer) == CreatureRef(uid=blocker.uid)
