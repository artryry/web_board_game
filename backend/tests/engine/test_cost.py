import json
from pathlib import Path
from typing import Any

import pytest

from app.engine.cost import balance, card_points, suggest_mana_cost

# Shared with the frontend's cost-suggestion tests, so both sides run the same cases.
CASES_FILE = Path(__file__).resolve().parents[1] / "fixtures" / "cost_cases.json"
CASES: list[dict[str, Any]] = json.loads(CASES_FILE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[case["case"] for case in CASES])
def test_cost_case(case: dict[str, Any]) -> None:
    points = card_points(case["kind"], case["hp"], case["dmg"], case["ability_costs"])
    suggested = suggest_mana_cost(points)

    assert points == case["points"]
    assert suggested == case["suggested"]
    assert balance(case["mana_cost"], suggested) == case["balance"]


@pytest.mark.parametrize(
    ("points", "expected"), [(-5, 0), (0, 0), (1, 0), (2, 1), (21, 10), (22, 11), (50, 25)]
)
def test_suggestion_has_a_floor_but_no_cap(points: int, expected: int) -> None:
    assert suggest_mana_cost(points) == expected
