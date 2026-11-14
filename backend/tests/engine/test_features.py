"""Each feature's hooks. How they play out in fights is in test_combat, test_targets and
test_field_bonus."""

from app.engine.context import EngineContext
from app.engine.registry import FeatureModule, StatDelta, registry
from tests.engine.builders import creature, new_game, origin, put_creature, ref


def _feature(key: str, **params: int) -> FeatureModule:
    return registry.build(FeatureModule, ref(key, **params))


def test_plain_features_change_nothing_by_default() -> None:
    plain = _feature("lifesteal_section")

    assert not plain.must_be_attacked_first()
    assert not plain.ready_when_summoned()
    assert plain.attack_lanes(1, 3) == {1}
    assert plain.damage_taken(4) == 4


def test_taunt_and_charge() -> None:
    assert _feature("taunt").must_be_attacked_first()
    assert _feature("charge").ready_when_summoned()


def test_ranged_adds_the_neighbouring_lanes_within_the_board() -> None:
    ranged = _feature("ranged")

    assert ranged.attack_lanes(0, 1) == {0}
    assert ranged.attack_lanes(0, 3) == {0, 1}
    assert ranged.attack_lanes(2, 5) == {1, 2, 3}


def test_armor_takes_its_amount_off_each_hit() -> None:
    armor = _feature("armor", amount=2)

    assert [armor.damage_taken(hit) for hit in (5, 2, 1)] == [3, 0, 0]


def test_field_affinity_needs_the_deck_origin() -> None:
    state = new_game()
    affinity = _feature("field_affinity", bonus=2)
    elk = put_creature(state, 0, 0, 0, creature("Elk"))

    assert affinity.field_bonus(elk, origin("forest")) == StatDelta(hp=2, dmg=2)
    assert affinity.field_bonus(elk, origin("volcano")) == StatDelta()


def test_lifesteal_heals_the_section_in_its_lane() -> None:
    state = new_game()
    state.sections[0][2].hp = 10
    leech = put_creature(state, 0, 2, 0, creature("Leech"))
    ctx = EngineContext(state)

    _feature("lifesteal_section").on_damage_dealt(ctx, ctx.creature(leech.uid), 4)

    assert state.sections[0][2].hp == 14


def test_deathrattle_hits_the_enemy_section_in_its_lane() -> None:
    state = new_game()
    martyr = put_creature(state, 1, 1, 0, creature("Martyr"))
    ctx = EngineContext(state)

    _feature("deathrattle_damage", amount=3).on_death(ctx, martyr, 1)

    assert [section.hp for section in state.sections[0]] == [20, 17, 20]
