"""A deck against a ruleset's `deck` rules, and the snapshot a game starts from (M6)."""

import json
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.engine.runner import start_game
from app.models.card import Card
from app.models.deck import Deck, DeckCard
from app.models.origin import Origin
from app.schemas.rules import DeckRules, RulesetDefinition
from app.services import card_service, deck_service
from tests.helpers import PUBLIC_BASE_URL, make_settings

# The frontend's deckProblems.test.ts runs the same file, so the two checks can't drift.
CASES_FILE = Path(__file__).resolve().parent / "fixtures" / "deck_rule_cases.json"
CASES: list[dict[str, Any]] = json.loads(CASES_FILE.read_text(encoding="utf-8"))

ORIGIN_IDS = {"neutral": uuid4(), "forest": uuid4()}


def _card(name: str, origin_id: UUID, mana_cost: int = 1, art_key: str | None = None) -> Card:
    return Card(
        id=uuid4(),
        owner_id=uuid4(),
        kind="creature",
        name=name,
        origin_id=origin_id,
        mana_cost=mana_cost,
        hp=2,
        dmg=1,
        abilities=[],
        art_key=art_key,
    )


def _deck(origin_id: UUID, cards: list[tuple[Card, int]]) -> Deck:
    return Deck(
        id=uuid4(),
        owner_id=uuid4(),
        name="Pack",
        origin_id=origin_id,
        cards=[DeckCard(card=card, count=count) for card, count in cards],
    )


def _case_deck(case: dict[str, Any]) -> Deck:
    cards = [
        (_card(entry["name"], ORIGIN_IDS[entry["origin"]], entry["mana_cost"]), entry["count"])
        for entry in case["cards"]
    ]
    return _deck(ORIGIN_IDS[case["deck_origin"]], cards)


def test_the_case_file_has_cases() -> None:
    assert len(CASES) >= 5


@pytest.mark.parametrize("case", CASES, ids=[case["case"] for case in CASES])
def test_deck_problems(case: dict[str, Any]) -> None:
    deck = _case_deck(case)
    # The frontend keeps the cards in the order given, the backend sorts them by mana cost and
    # name; listing them in that order keeps both sides' card lists the same.
    in_order = [entry.card for entry in deck.cards]
    assert in_order == sorted(in_order, key=card_service.card_sort_key)

    problems = deck_service.deck_problems(
        deck, DeckRules.model_validate(case["rules"]), ORIGIN_IDS["neutral"]
    )

    as_names = []
    for problem in problems:
        dumped = problem.model_dump()
        if "cards" in dumped:
            dumped["cards"] = [card["name"] for card in dumped["cards"]]
        as_names.append(dumped)
    assert as_names == case["problems"]


def test_deck_problems_name_cards_by_id_and_name() -> None:
    wolf = _card("Wolf", ORIGIN_IDS["forest"])
    deck = _deck(ORIGIN_IDS["forest"], [(wolf, 3)])

    problems = deck_service.deck_problems(
        deck, DeckRules(size=10, max_copies=2), ORIGIN_IDS["neutral"]
    )

    assert problems[1].model_dump(mode="json") == {
        "kind": "copies",
        "max": 2,
        "cards": [{"id": str(wolf.id), "name": "Wolf"}],
    }


# --- Snapshots ---


def _origin(art_key: str | None = None) -> Origin:
    return Origin(
        id=ORIGIN_IDS["forest"],
        name="Forest",
        color="bluish_green",
        icon="leaf",
        field_effects=[{"key": "free_move", "params": {}}],
        background_art_key=art_key,
    )


def test_a_snapshot_has_one_card_per_copy_in_deck_order_with_art_urls() -> None:
    wolf = _card("Wolf", ORIGIN_IDS["forest"], mana_cost=2, art_key="card-art/u/wolf.png")
    scout = _card("Scout", ORIGIN_IDS["neutral"], mana_cost=1)
    deck = _deck(ORIGIN_IDS["forest"], [(wolf, 2), (scout, 1)])

    snapshot = deck_service.deck_snapshot(deck, _origin("origin-art/u/forest.png"), make_settings())

    assert [card.name for card in snapshot.cards] == ["Scout", "Wolf", "Wolf"]
    assert snapshot.cards[1].card_id == str(wolf.id)
    assert snapshot.cards[1].art_url == f"{PUBLIC_BASE_URL}/card-art/u/wolf.png"
    assert snapshot.cards[0].art_url is None
    assert snapshot.origin.origin_id == str(ORIGIN_IDS["forest"])
    assert snapshot.origin.background_art_url == f"{PUBLIC_BASE_URL}/origin-art/u/forest.png"
    assert [effect.key for effect in snapshot.origin.field_effects] == ["free_move"]


def test_snapshots_start_a_game() -> None:
    cards = [(_card(f"C{n}", ORIGIN_IDS["forest"], mana_cost=n), 2) for n in range(5)]
    snapshot = deck_service.deck_snapshot(
        _deck(ORIGIN_IDS["forest"], cards), _origin(), make_settings()
    )

    state, _ = start_game(RulesetDefinition(), (snapshot, snapshot), seed=7)

    assert state.status == "playing"
    assert sum(len(player.deck) + len(player.hand) for player in state.players) == 20
