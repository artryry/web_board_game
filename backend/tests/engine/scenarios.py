"""Full-game setups shared by the board-size, golden-replay and random-game tests."""

from app.engine.snapshots import CardSnapshot, DeckSnapshot, OriginSnapshot
from app.schemas.rules import RulesetDefinition
from tests.engine.builders import NEUTRAL, creature, deck, origin, ref, rules, spell

# A mixed pool: every feature and every spell appears.
CARD_POOL: list[CardSnapshot] = [
    creature("Wolf", 3, 2, 1),
    creature("Bear", 5, 3, 3, ref("taunt")),
    creature("Hawk", 2, 2, 2, ref("ranged")),
    creature("Rider", 2, 2, 2, ref("charge")),
    creature("Knight", 4, 2, 3, ref("armor", amount=1)),
    creature("Leech", 3, 2, 2, ref("lifesteal_section")),
    creature("Martyr", 1, 1, 1, ref("deathrattle_damage", amount=2)),
    creature("Druid", 2, 2, 2, ref("field_affinity", bonus=1)),
    creature("Rat", 1, 1, 0, origin_id=NEUTRAL),
    spell("deal_damage", dmg=2, cost=1),
    spell("damage_section", dmg=2, cost=2),
    spell("heal", dmg=-3, cost=1),
    spell("heal", dmg=-3, cost=1, target="section"),
    spell("draw_cards", cost=2, count=1),
    spell("buff", cost=1, params={"dmg": 1, "hp": 1}),
    spell("summon_token", cost=2, params={"hp": 2, "dmg": 1}),
    spell("move_enemy", cost=1),
]

FOREST = origin("forest", ref("stat_bonus", applies_to="own_origin", hp=1, dmg=0))
VOLCANO = origin("volcano", ref("stat_bonus", applies_to="all_own", hp=0, dmg=1))
OCEAN = origin("ocean", ref("free_move"), ref("spell_power", amount=1))
MOUNTAIN = origin(
    "mountain",
    ref("section_hp_bonus", amount=5),
    ref("turn_start_heal_section", amount=1),
    ref("attacker_penalty", hp=1, dmg=1),
)
ARCANE = origin("arcane", ref("mana_discount", card_kind="spell", amount=1))


def pool_deck(deck_origin_id: str, size: int) -> list[CardSnapshot]:
    """`size` cards from the pool, in pool order, with the deck's origin on its own cards."""
    cards = []
    for index in range(size):
        card = CARD_POOL[index % len(CARD_POOL)]
        if card.origin_id != NEUTRAL:
            card = card.model_copy(update={"origin_id": deck_origin_id})
        cards.append(card)
    return cards


def decks(
    size: int, first: OriginSnapshot = FOREST, second: OriginSnapshot = VOLCANO
) -> tuple[DeckSnapshot, DeckSnapshot]:
    return (
        deck(first, pool_deck(first.origin_id, size)),
        deck(second, pool_deck(second.origin_id, size)),
    )


def board_rules(lanes: int) -> RulesetDefinition:
    return rules(board={"lanes": lanes, "section_hp": 8}, deck={"size": 20})


RESTORE_BOTH_RULES = rules(
    mana={"start": 2, "per_turn": 2, "max": 6, "mode": "restore"},
    hand={"max_size": 5},
    turn=[
        ref("gain_mana"),
        ref("draw", count=2),
        ref("action_phase", actor="both", allow=["play", "move"], time_limit_s=60),
        ref("lane_combat"),
        ref("discard_to_hand_limit"),
        ref("end_turn"),
    ],
)

ONE_LANE_RULES = rules(board={"lanes": 1, "slots_per_section": 4, "section_hp": 15})

# Ranged and taunt matter most on one lane: ranged has no neighbour, taunt guards the only lane.
ONE_LANE_CARDS: list[CardSnapshot] = [
    creature("Hawk", 2, 2, 2, ref("ranged")),
    creature("Bear", 5, 2, 3, ref("taunt")),
    creature("Wolf", 3, 2, 1),
    creature("Martyr", 1, 1, 1, ref("deathrattle_damage", amount=2)),
    creature("Leech", 3, 2, 2, ref("lifesteal_section")),
    spell("deal_damage", dmg=2, cost=1),
]
