"""The mana-cost suggestion (backend_plan §7.8).

It is only advice: the card author always sets the final `mana_cost`. The frontend mirrors this
formula and runs the same cases from `tests/fixtures/cost_cases.json`.
"""

from collections.abc import Sequence
from typing import Literal

CardKind = Literal["creature", "spell"]
Balance = Literal["under", "balanced", "over"]

MIN_MANA_COST = 0
MAX_MANA_COST = 10


def card_points(
    kind: CardKind, hp: int | None, dmg: int | None, ability_costs: Sequence[int]
) -> int:
    """Budget points of a card. A spell counts `|dmg|`, so healing 3 costs the same as 3 damage."""
    if kind == "creature":
        return (hp or 0) + (dmg or 0) + sum(ability_costs)
    return abs(dmg or 0) + sum(ability_costs)


def suggest_mana_cost(points: int) -> int:
    # ceil((points - 1) / 2) in integer maths, so there are no float rounding surprises.
    suggested = -(-(points - 1) // 2)
    # return real mana cost even if it's over the top cap
    return max(MIN_MANA_COST, suggested)


def balance(mana_cost: int, suggested: int) -> Balance:
    """`under` means cheaper than suggested; `balanced` only on an exact match."""
    if mana_cost < suggested:
        return "under"
    if mana_cost > suggested:
        return "over"
    return "balanced"
