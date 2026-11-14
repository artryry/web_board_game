"""Each spell: what it can target and what it does, played through `apply_action`."""

from app.engine.actions import (
    CreatureRef,
    CreatureToSlotRef,
    PlayCard,
    SectionRef,
    SlotRef,
    Target,
)
from app.engine.events import CreatureDied
from app.engine.legality import legal_actions
from app.engine.snapshots import CardSnapshot
from app.engine.state import GameState
from tests.engine.builders import (
    act,
    bare_rules,
    creature,
    creature_at,
    filler_decks,
    give_card,
    new_game,
    origin,
    put_creature,
    ref,
    set_mana,
    spell,
)


def _with_spell(card: CardSnapshot, state: GameState | None = None) -> tuple[GameState, str]:
    state = state or new_game()
    set_mana(state, 0, 10)
    return state, give_card(state, 0, card)


def _targets(state: GameState, uid: str) -> list[Target | None]:
    return [
        action.target
        for action in legal_actions(state, 0)
        if isinstance(action, PlayCard) and action.card_uid == uid
    ]


def test_deal_damage_hits_an_enemy_creature_through_armor() -> None:
    state, bolt = _with_spell(spell("deal_damage", dmg=3))
    own = put_creature(state, 0, 0, 0, creature())
    enemy = put_creature(state, 1, 0, 0, creature("Knight", 5, 1, 1, ref("armor", amount=1)))

    assert _targets(state, bolt) == [CreatureRef(uid=enemy.uid)]
    state, _ = act(state, 0, PlayCard(card_uid=bolt, target=CreatureRef(uid=enemy.uid)))

    assert creature_at(state, 1, 0, 0).hp == 3
    assert creature_at(state, 0, 0, 0).uid == own.uid


def test_deal_damage_on_any_creature_includes_the_own_and_kills() -> None:
    state, bolt = _with_spell(spell("deal_damage", dmg=2, target="any_creature"))
    own = put_creature(state, 0, 0, 0, creature())
    enemy = put_creature(state, 1, 0, 0, creature())

    assert _targets(state, bolt) == [CreatureRef(uid=enemy.uid), CreatureRef(uid=own.uid)]
    state, events = act(state, 0, PlayCard(card_uid=bolt, target=CreatureRef(uid=own.uid)))

    assert CreatureDied(uid=own.uid, seat=0, lane=0, slot=0) in events


def test_spell_power_adds_to_damage_spells() -> None:
    powered = origin("arcane", ref("spell_power", amount=2))
    state, bolt = _with_spell(
        spell("damage_section", dmg=3), new_game(bare_rules(), filler_decks(origin0=powered))
    )

    state, _ = act(state, 0, PlayCard(card_uid=bolt, target=SectionRef(seat=1, lane=1)))

    assert state.sections[1][1].hp == 15


def test_damage_section_targets_enemy_sections_that_arent_conquered() -> None:
    state, bolt = _with_spell(spell("damage_section", dmg=4))
    state.sections[1][0].hp = 0
    state.sections[1][0].conquered = True

    assert _targets(state, bolt) == [SectionRef(seat=1, lane=1), SectionRef(seat=1, lane=2)]
    state, _ = act(state, 0, PlayCard(card_uid=bolt, target=SectionRef(seat=1, lane=2)))

    assert state.sections[1][2].hp == 16


def test_heal_a_creature_up_to_its_maximum() -> None:
    state, salve = _with_spell(spell("heal", dmg=-5))
    wolf = put_creature(state, 0, 0, 0, creature("Wolf", 4, 1))
    wolf.hp = 1
    put_creature(state, 1, 0, 0, creature())

    assert _targets(state, salve) == [CreatureRef(uid=wolf.uid)]
    state, _ = act(state, 0, PlayCard(card_uid=salve, target=CreatureRef(uid=wolf.uid)))

    assert creature_at(state, 0, 0, 0).hp == 4


def test_heal_a_section_that_isnt_conquered() -> None:
    state, salve = _with_spell(spell("heal", dmg=-3, target="section"))
    state.sections[0][0].hp = 0
    state.sections[0][0].conquered = True
    state.sections[0][1].hp = 15

    assert _targets(state, salve) == [SectionRef(seat=0, lane=1), SectionRef(seat=0, lane=2)]
    state, _ = act(state, 0, PlayCard(card_uid=salve, target=SectionRef(seat=0, lane=1)))

    assert state.sections[0][1].hp == 18


def test_draw_cards_takes_no_target() -> None:
    state, study = _with_spell(spell("draw_cards", count=2))

    assert _targets(state, study) == [None]
    state, _ = act(state, 0, PlayCard(card_uid=study, target=None))

    assert len(state.players[0].hand) == 2


def test_buff_raises_dmg_hp_and_maximum() -> None:
    state, rally = _with_spell(spell("buff", params={"dmg": 2, "hp": 3}))
    wolf = put_creature(state, 0, 0, 0, creature("Wolf", 2, 1))

    state, _ = act(state, 0, PlayCard(card_uid=rally, target=CreatureRef(uid=wolf.uid)))

    buffed = creature_at(state, 0, 0, 0)
    assert (buffed.hp, buffed.max_hp, buffed.dmg) == (5, 5, 3)


def test_summon_token_fills_an_empty_own_slot_with_a_sick_token() -> None:
    forest_bonus = origin("forest", ref("stat_bonus", hp=1))
    state, call = _with_spell(
        spell("summon_token", params={"hp": 2, "dmg": 1}),
        new_game(bare_rules(), filler_decks(forest_bonus)),
    )
    put_creature(state, 0, 0, 0, creature())

    assert SlotRef(seat=0, lane=0, slot=0) not in _targets(state, call)
    state, _ = act(state, 0, PlayCard(card_uid=call, target=SlotRef(seat=0, lane=1, slot=2)))

    token = creature_at(state, 0, 1, 2)
    assert token.uid.startswith("t")
    assert (token.card.name, token.card.origin_id, token.features) == ("Summon Token", "forest", [])
    assert (token.hp, token.dmg, token.exhausted) == (3, 1, True)


def test_move_enemy_moves_an_enemy_creature_on_its_own_side() -> None:
    state, shove = _with_spell(spell("move_enemy"))
    state.sections[1][2].hp = 0
    state.sections[1][2].conquered = True
    bonus = origin("volcano", ref("stat_bonus", hp=0, dmg=1))
    state.players[1].origin = bonus
    enemy = put_creature(state, 1, 0, 0, creature("Imp", 2, 1, origin_id="volcano"))
    assert enemy.dmg == 2

    target = CreatureToSlotRef(uid=enemy.uid, to=SlotRef(seat=1, lane=2, slot=1))
    assert target in _targets(state, shove)
    state, _ = act(state, 0, PlayCard(card_uid=shove, target=target))

    moved = creature_at(state, 1, 2, 1)
    assert (moved.uid, moved.dmg, moved.has_moved) == (enemy.uid, 1, False)
