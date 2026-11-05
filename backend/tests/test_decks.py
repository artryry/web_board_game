from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Card
from tests.helpers import (
    AuthedUser,
    assert_error,
    create_card,
    create_deck,
    create_origin,
    system_origin_id,
)


def card_counts(deck: dict[str, Any]) -> list[tuple[str, int]]:
    return [(entry["card"]["name"], entry["count"]) for entry in deck["cards"]]


async def test_decks_need_login(client: AsyncClient) -> None:
    assert_error(await client.get("/api/decks"), 401, "not_authenticated")


# --- create and read ---


async def test_create_deck_with_origin_and_neutral_cards(
    client: AsyncClient, alice: AuthedUser
) -> None:
    swamp = await create_origin(client, alice)
    toad = await create_card(client, alice, name="Toad", mana_cost=3, origin_id=swamp["id"])
    eel = await create_card(client, alice, name="eel", mana_cost=1, origin_id=swamp["id"])
    wolf = await create_card(client, alice, name="Wolf", mana_cost=1)  # neutral

    deck = await create_deck(
        client, alice, [(toad, 2), (eel, 1), (wolf, 4)], name="  Bog  ", origin_id=swamp["id"]
    )

    assert deck["name"] == "Bog"
    assert deck["origin_id"] == swamp["id"]
    assert deck["card_count"] == 7
    assert deck["share_code"] is None
    # By mana cost, then name ignoring case.
    assert card_counts(deck) == [("eel", 1), ("Wolf", 4), ("Toad", 2)]
    assert deck["cards"][0]["card"] == eel


async def test_get_deck(client: AsyncClient, alice: AuthedUser) -> None:
    wolf = await create_card(client, alice)
    deck = await create_deck(client, alice, [(wolf, 2)])

    response = await client.get(f"/api/decks/{deck['id']}", headers=alice.headers)

    assert response.status_code == 200
    assert response.json() == deck


async def test_an_empty_deck_can_be_saved(client: AsyncClient, alice: AuthedUser) -> None:
    deck = await create_deck(client, alice, [])

    assert deck["cards"] == []
    assert deck["card_count"] == 0


async def test_list_decks_newest_first(client: AsyncClient, alice: AuthedUser) -> None:
    wolf = await create_card(client, alice)
    await create_deck(client, alice, [(wolf, 3)], name="Old")
    await create_deck(client, alice, [], name="New")

    response = await client.get("/api/decks?limit=1", headers=alice.headers)
    everything = await client.get("/api/decks", headers=alice.headers)

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert [deck["name"] for deck in body["items"]] == ["New"]
    items = everything.json()["items"]
    assert [(deck["name"], deck["card_count"]) for deck in items] == [("New", 0), ("Old", 3)]
    assert "cards" not in items[0]


async def test_deck_on_a_system_origin(client: AsyncClient, alice: AuthedUser) -> None:
    forest_id = await system_origin_id(client, alice, "forest")
    elk = await create_card(client, alice, name="Elk", origin_id=forest_id)
    wolf = await create_card(client, alice)

    deck = await create_deck(client, alice, [(elk, 2), (wolf, 1)], origin_id=forest_id)

    assert deck["origin_id"] == forest_id


# --- deck rules ---


async def test_deck_origin_must_be_own_or_system(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    bobs_origin = await create_origin(client, bob)

    for origin_id in (bobs_origin["id"], str(uuid4())):
        response = await client.post(
            "/api/decks",
            json={"name": "Pack", "origin_id": origin_id, "cards": []},
            headers=alice.headers,
        )
        assert_error(response, 422, "invalid_origin")


async def test_deck_cards_must_be_own(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    neutral_id = await system_origin_id(client, alice)
    bobs_card = await create_card(client, bob)

    for card_id in (bobs_card["id"], str(uuid4())):
        response = await client.post(
            "/api/decks",
            json={
                "name": "Pack",
                "origin_id": neutral_id,
                "cards": [{"card_id": card_id, "count": 1}],
            },
            headers=alice.headers,
        )
        assert_error(response, 422, "invalid_deck_cards")


async def test_a_card_is_listed_once(client: AsyncClient, alice: AuthedUser) -> None:
    neutral_id = await system_origin_id(client, alice)
    wolf = await create_card(client, alice)
    entry = {"card_id": wolf["id"], "count": 1}

    response = await client.post(
        "/api/decks",
        json={"name": "Pack", "origin_id": neutral_id, "cards": [entry, entry]},
        headers=alice.headers,
    )

    assert_error(response, 422, "invalid_deck_cards")


@pytest.mark.parametrize("count", [0, 5])
async def test_copy_count_is_bounded(client: AsyncClient, alice: AuthedUser, count: int) -> None:
    neutral_id = await system_origin_id(client, alice)
    wolf = await create_card(client, alice)

    response = await client.post(
        "/api/decks",
        json={
            "name": "Pack",
            "origin_id": neutral_id,
            "cards": [{"card_id": wolf["id"], "count": count}],
        },
        headers=alice.headers,
    )

    assert response.status_code == 422


async def test_deck_holds_at_most_60_cards(client: AsyncClient, alice: AuthedUser) -> None:
    cards = [await create_card(client, alice, name=f"Wolf {n}") for n in range(16)]
    full = [(card, 4) for card in cards[:15]]  # 60 cards

    deck = await create_deck(client, alice, full)
    too_many = await client.patch(
        f"/api/decks/{deck['id']}",
        json={
            "cards": [{"card_id": card["id"], "count": n} for card, n in [*full, (cards[15], 1)]]
        },
        headers=alice.headers,
    )

    assert deck["card_count"] == 60
    assert_error(too_many, 422, "deck_too_large")


async def test_cards_must_have_the_deck_origin_or_be_neutral(
    client: AsyncClient, alice: AuthedUser
) -> None:
    swamp = await create_origin(client, alice, name="Swamp")
    forest_id = await system_origin_id(client, alice, "forest")
    elk = await create_card(client, alice, name="Elk", origin_id=forest_id)
    ant = await create_card(client, alice, name="Ant", origin_id=forest_id)
    wolf = await create_card(client, alice)

    response = await client.post(
        "/api/decks",
        json={
            "name": "Bog",
            "origin_id": swamp["id"],
            "cards": [{"card_id": card["id"], "count": 1} for card in (elk, wolf, ant)],
        },
        headers=alice.headers,
    )

    detail = assert_error(response, 422, "card_origin_mismatch")
    assert detail["cards"] == [{"id": ant["id"], "name": "Ant"}, {"id": elk["id"], "name": "Elk"}]


async def test_a_neutral_deck_holds_only_neutral_cards(
    client: AsyncClient, alice: AuthedUser
) -> None:
    neutral_id = await system_origin_id(client, alice)
    forest_id = await system_origin_id(client, alice, "forest")
    wolf = await create_card(client, alice)
    elk = await create_card(client, alice, name="Elk", origin_id=forest_id)

    deck = await create_deck(client, alice, [(wolf, 2)])
    with_elk = await client.post(
        "/api/decks",
        json={
            "name": "Pack",
            "origin_id": neutral_id,
            "cards": [{"card_id": elk["id"], "count": 1}],
        },
        headers=alice.headers,
    )

    assert deck["origin_id"] == neutral_id
    assert_error(with_elk, 422, "card_origin_mismatch")


# --- update ---


async def test_patch_replaces_the_card_list(client: AsyncClient, alice: AuthedUser) -> None:
    kept, changed, removed, added = [
        await create_card(client, alice, name=name, mana_cost=cost)
        for cost, name in enumerate(["Kept", "Changed", "Removed", "Added"])
    ]
    deck = await create_deck(client, alice, [(kept, 1), (changed, 1), (removed, 2)])

    response = await client.patch(
        f"/api/decks/{deck['id']}",
        json={
            "cards": [
                {"card_id": kept["id"], "count": 1},
                {"card_id": changed["id"], "count": 3},
                {"card_id": added["id"], "count": 2},
            ]
        },
        headers=alice.headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert card_counts(body) == [("Kept", 1), ("Changed", 3), ("Added", 2)]
    assert body["card_count"] == 6
    assert datetime.fromisoformat(body["updated_at"]) > datetime.fromisoformat(deck["updated_at"])
    assert (await client.get(f"/api/decks/{deck['id']}", headers=alice.headers)).json() == body


async def test_patch_name_keeps_the_cards(client: AsyncClient, alice: AuthedUser) -> None:
    wolf = await create_card(client, alice)
    deck = await create_deck(client, alice, [(wolf, 2)])

    response = await client.patch(
        f"/api/decks/{deck['id']}", json={"name": "Renamed"}, headers=alice.headers
    )

    assert response.json()["name"] == "Renamed"
    assert card_counts(response.json()) == [("Wolf", 2)]


@pytest.mark.parametrize("field", ["name", "origin_id", "cards"])
async def test_patch_rejects_null(client: AsyncClient, alice: AuthedUser, field: str) -> None:
    deck = await create_deck(client, alice, [])

    response = await client.patch(
        f"/api/decks/{deck['id']}", json={field: None}, headers=alice.headers
    )

    assert response.status_code == 422


async def test_changing_the_origin_needs_the_old_cards_gone(
    client: AsyncClient, alice: AuthedUser
) -> None:
    swamp = await create_origin(client, alice, name="Swamp")
    forest_id = await system_origin_id(client, alice, "forest")
    toad = await create_card(client, alice, name="Toad", origin_id=swamp["id"])
    wolf = await create_card(client, alice)
    elk = await create_card(client, alice, name="Elk", origin_id=forest_id)
    deck = await create_deck(client, alice, [(toad, 2), (wolf, 1)], origin_id=swamp["id"])
    url = f"/api/decks/{deck['id']}"

    origin_only = await client.patch(url, json={"origin_id": forest_id}, headers=alice.headers)
    with_cards = await client.patch(
        url,
        json={
            "origin_id": forest_id,
            "cards": [{"card_id": wolf["id"], "count": 1}, {"card_id": elk["id"], "count": 2}],
        },
        headers=alice.headers,
    )

    detail = assert_error(origin_only, 422, "card_origin_mismatch")
    assert detail["cards"] == [{"id": toad["id"], "name": "Toad"}]
    assert with_cards.status_code == 200, with_cards.text
    assert with_cards.json()["origin_id"] == forest_id
    assert card_counts(with_cards.json()) == [("Elk", 2), ("Wolf", 1)]


# --- delete and ownership ---


async def test_delete_deck_keeps_its_cards(client: AsyncClient, alice: AuthedUser) -> None:
    wolf = await create_card(client, alice)
    deck = await create_deck(client, alice, [(wolf, 2)])

    response = await client.delete(f"/api/decks/{deck['id']}", headers=alice.headers)
    after = await client.get(f"/api/decks/{deck['id']}", headers=alice.headers)
    card = await client.get(f"/api/cards/{wolf['id']}", headers=alice.headers)
    delete_card = await client.delete(f"/api/cards/{wolf['id']}", headers=alice.headers)

    assert response.status_code == 204
    assert_error(after, 404, "deck_not_found")
    assert card.status_code == 200
    assert delete_card.status_code == 204  # no deck holds it any more


async def test_the_database_refuses_to_delete_a_held_card(
    client: AsyncClient, db: AsyncSession, alice: AuthedUser
) -> None:
    # The service answers with 409 first; this is the database backing it up (checked at COMMIT,
    # which SET CONSTRAINTS brings forward, since the test transaction never commits).
    wolf = await create_card(client, alice)
    await create_deck(client, alice, [(wolf, 1)])

    await db.execute(delete(Card).where(Card.id == UUID(wolf["id"])))
    with pytest.raises(IntegrityError, match="fk_deck_cards_card_id_cards"):
        await db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))


async def test_other_users_decks_are_hidden(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    deck = await create_deck(client, alice, [])
    url = f"/api/decks/{deck['id']}"

    listed = (await client.get("/api/decks", headers=bob.headers)).json()
    get = await client.get(url, headers=bob.headers)
    patch = await client.patch(url, json={"name": "Mine"}, headers=bob.headers)
    delete = await client.delete(url, headers=bob.headers)

    assert listed == {"items": [], "total": 0}
    assert_error(get, 404, "deck_not_found")
    assert_error(patch, 404, "deck_not_found")
    assert_error(delete, 404, "deck_not_found")
