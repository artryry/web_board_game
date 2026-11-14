"""Each field effect's hooks. stat_bonus is in test_field_bonus, attacker_penalty in test_combat,
free_move and mana_discount in test_legality, spell_power in test_spells."""

from app.engine.registry import FieldEffectModule, StatDelta, registry
from app.engine.runner import start_game
from tests.engine.builders import (
    bare_rules,
    creature,
    filler_decks,
    new_game,
    origin,
    pass_turn,
    ref,
    spell,
)


def _effect(key: str, **params: object) -> FieldEffectModule:
    return registry.build(FieldEffectModule, ref(key, **params))


def test_simple_hooks() -> None:
    assert not _effect("free_move").move_uses_action()
    assert _effect("spell_power", amount=2).spell_damage_bonus() == 2
    assert _effect("attacker_penalty", hp=1, dmg=2).attacker_penalty() == StatDelta(hp=1, dmg=2)
    assert _effect("section_hp_bonus").move_uses_action()


def test_mana_discount_applies_to_its_card_kind_only() -> None:
    discount = _effect("mana_discount", card_kind="creature", amount=2)

    assert discount.cost_change(creature()) == -2
    assert discount.cost_change(spell("draw_cards")) == 0


def test_section_hp_bonus_raises_the_owner_sections_at_the_start() -> None:
    sturdy = origin("mountain", ref("section_hp_bonus", amount=5))

    state, _ = start_game(bare_rules(), filler_decks(origin1=sturdy), seed=1)

    assert [(s.hp, s.max_hp) for s in state.sections[1]] == [(25, 25)] * 3
    assert [(s.hp, s.max_hp) for s in state.sections[0]] == [(20, 20)] * 3


def test_regeneration_heals_live_sections_at_the_start_of_the_owner_turn() -> None:
    regen = origin("grove", ref("turn_start_heal_section", amount=2))
    state = new_game(bare_rules(), filler_decks(origin1=regen))
    for section in state.sections[1]:
        section.hp = 10
    state.sections[1][2].hp = 0
    state.sections[1][2].conquered = True

    state = pass_turn(state)

    assert [section.hp for section in state.sections[1]] == [12, 12, 0]
    state = pass_turn(state)
    assert [section.hp for section in state.sections[1]] == [12, 12, 0]
