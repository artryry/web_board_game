from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.helpers import (
    AuthedUser,
    assert_error,
    create_card,
    create_deck,
    create_group,
    create_origin,
    system_origin_id,
)

TAUNT = {"key": "taunt"}


async def test_cards_need_login(client: AsyncClient) -> None:
    assert_error(await client.get("/api/cards"), 401, "not_authenticated")


# --- create ---


async def test_create_creature(client: AsyncClient, alice: AuthedUser) -> None:
    card = await create_card(
        client,
        alice,
        name="Guard",
        hp=3,
        dmg=3,
        mana_cost=4,
        abilities=[TAUNT, {"key": "armor", "params": {"amount": 2}}],
    )

    assert card["kind"] == "creature"
    assert card["name"] == "Guard"
    assert (card["hp"], card["dmg"], card["mana_cost"]) == (3, 3, 4)
    assert card["abilities"] == [
        {"key": "taunt", "params": {}},
        {"key": "armor", "params": {"amount": 2}},
    ]
    # 3 + 3 + taunt 2 + armor 2 = 10 points -> ceil(9 / 2) = 5
    assert card["suggested_mana_cost"] == 5
    assert card["balance"] == "under"
    assert card["group_id"] is None
    assert card["art_url"] is None


@pytest.mark.parametrize(
    ("ability", "dmg", "stored_dmg", "suggested"),
    [
        ({"key": "deal_damage"}, 3, 3, 2),  # |3| + 1 = 4 -> 2
        ({"key": "heal", "params": {"target": "section"}}, -3, -3, 2),  # heal costs like damage
        ({"key": "draw_cards", "params": {"count": 2}}, 0, None, 2),  # 0 is stored as null
        ({"key": "draw_cards"}, None, None, 1),
    ],
)
async def test_create_spell(
    client: AsyncClient,
    alice: AuthedUser,
    ability: dict[str, Any],
    dmg: int | None,
    stored_dmg: int | None,
    suggested: int,
) -> None:
    card = await create_card(
        client, alice, kind="spell", hp=None, dmg=dmg, mana_cost=1, abilities=[ability]
    )

    assert card["kind"] == "spell"
    assert card["hp"] is None
    assert card["dmg"] == stored_dmg
    assert card["suggested_mana_cost"] == suggested


@pytest.mark.parametrize(("mana_cost", "balance"), [(0, "under"), (1, "balanced"), (10, "over")])
async def test_mana_cost_is_kept_as_set(
    client: AsyncClient, alice: AuthedUser, mana_cost: int, balance: str
) -> None:
    card = await create_card(client, alice, hp=2, dmg=1, mana_cost=mana_cost)

    assert card["mana_cost"] == mana_cost
    assert card["suggested_mana_cost"] == 1
    assert card["balance"] == balance


async def test_card_can_use_own_or_system_origin(client: AsyncClient, alice: AuthedUser) -> None:
    origin = await create_origin(client, alice)
    forest_id = await system_origin_id(client, alice, "forest")

    own = await create_card(client, alice, origin_id=origin["id"])
    system = await create_card(client, alice, origin_id=forest_id)

    assert own["origin_id"] == origin["id"]
    assert system["origin_id"] == forest_id


# --- validation ---

CREATURE = {"kind": "creature", "name": "Bad", "mana_cost": 1, "hp": 1, "dmg": 1}
SPELL = {"kind": "spell", "name": "Bad", "mana_cost": 1, "abilities": [{"key": "deal_damage"}]}


@pytest.mark.parametrize(
    ("body", "code"),
    [
        (CREATURE | {"hp": None}, "invalid_stats"),
        (CREATURE | {"dmg": None}, "invalid_stats"),
        (CREATURE | {"dmg": -1}, "invalid_stats"),
        (CREATURE | {"abilities": [{"key": "deal_damage"}]}, "unknown_module"),
        (CREATURE | {"abilities": [{"key": "flying"}]}, "unknown_module"),
        (CREATURE | {"abilities": [TAUNT, TAUNT]}, "invalid_abilities"),
        (CREATURE | {"abilities": [{"key": "armor", "params": {"amount": 9}}]}, "invalid_params"),
        (SPELL | {"dmg": 2, "hp": 2}, "invalid_stats"),
        (SPELL | {"abilities": []}, "invalid_abilities"),
        (
            SPELL | {"dmg": 2, "abilities": [{"key": "deal_damage"}, {"key": "draw_cards"}]},
            "invalid_abilities",
        ),
        (SPELL | {"abilities": [TAUNT]}, "unknown_module"),
        (SPELL | {"dmg": None}, "invalid_stats"),
        (SPELL | {"dmg": -2}, "invalid_stats"),
        (SPELL | {"dmg": 2, "abilities": [{"key": "heal"}]}, "invalid_stats"),
        (SPELL | {"dmg": 2, "abilities": [{"key": "draw_cards"}]}, "invalid_stats"),
    ],
)
async def test_kind_rules(
    client: AsyncClient, alice: AuthedUser, body: dict[str, Any], code: str
) -> None:
    body = body | {"origin_id": await system_origin_id(client, alice)}

    response = await client.post("/api/cards", json=body, headers=alice.headers)

    assert_error(response, 422, code)


@pytest.mark.parametrize(
    "overrides",
    [
        {"mana_cost": -1},
        {"mana_cost": 11},
        {"hp": 0},
        {"hp": 100},
        {"dmg": 100},
        {"name": " "},
        {"kind": "artifact"},
        {"abilities": [TAUNT, {"key": "charge"}, {"key": "ranged"}]},
    ],
)
async def test_hard_bounds(
    client: AsyncClient, alice: AuthedUser, overrides: dict[str, Any]
) -> None:
    body = CREATURE | {"origin_id": await system_origin_id(client, alice)} | overrides

    response = await client.post("/api/cards", json=body, headers=alice.headers)

    assert response.status_code == 422


async def test_origin_must_be_usable(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    bobs_origin = await create_origin(client, bob)

    for origin_id in (bobs_origin["id"], str(uuid4())):
        body = CREATURE | {"origin_id": origin_id}
        response = await client.post("/api/cards", json=body, headers=alice.headers)
        assert_error(response, 422, "invalid_origin")


# --- read, update, delete ---


async def test_get_card(client: AsyncClient, alice: AuthedUser) -> None:
    card = await create_card(client, alice)

    response = await client.get(f"/api/cards/{card['id']}", headers=alice.headers)

    assert response.status_code == 200
    assert response.json() == card


async def test_patch_changes_only_sent_fields(client: AsyncClient, alice: AuthedUser) -> None:
    card = await create_card(client, alice, abilities=[TAUNT])

    response = await client.patch(
        f"/api/cards/{card['id']}", json={"name": "Big wolf", "hp": 5}, headers=alice.headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Big wolf"
    assert body["hp"] == 5
    assert body["dmg"] == card["dmg"]
    assert body["abilities"] == card["abilities"]
    assert body["mana_cost"] == card["mana_cost"]


async def test_patch_kind_rechecks_the_whole_card(client: AsyncClient, alice: AuthedUser) -> None:
    card = await create_card(client, alice, abilities=[TAUNT])
    url = f"/api/cards/{card['id']}"
    to_spell = {"kind": "spell", "abilities": [{"key": "deal_damage"}], "dmg": 4}

    keeps_hp = await client.patch(url, json=to_spell, headers=alice.headers)
    clears_hp = await client.patch(url, json=to_spell | {"hp": None}, headers=alice.headers)

    assert_error(keeps_hp, 422, "invalid_stats")
    assert clears_hp.status_code == 200
    assert clears_hp.json()["kind"] == "spell"
    assert clears_hp.json()["hp"] is None


async def test_patch_rejects_null_for_required_field(
    client: AsyncClient, alice: AuthedUser
) -> None:
    card = await create_card(client, alice)

    response = await client.patch(
        f"/api/cards/{card['id']}", json={"mana_cost": None}, headers=alice.headers
    )

    assert response.status_code == 422


async def test_delete_card(client: AsyncClient, alice: AuthedUser) -> None:
    card = await create_card(client, alice)

    response = await client.delete(f"/api/cards/{card['id']}", headers=alice.headers)
    after = await client.get(f"/api/cards/{card['id']}", headers=alice.headers)

    assert response.status_code == 204
    assert_error(after, 404, "card_not_found")


async def test_delete_card_in_a_deck_lists_the_decks(
    client: AsyncClient, alice: AuthedUser
) -> None:
    wolf = await create_card(client, alice)
    beta = await create_deck(client, alice, [(wolf, 1)], name="beta")
    alpha = await create_deck(client, alice, [(wolf, 2)], name="Alpha")

    response = await client.delete(f"/api/cards/{wolf['id']}", headers=alice.headers)
    await client.patch(f"/api/decks/{alpha['id']}", json={"cards": []}, headers=alice.headers)
    await client.delete(f"/api/decks/{beta['id']}", headers=alice.headers)
    after_removal = await client.delete(f"/api/cards/{wolf['id']}", headers=alice.headers)

    detail = assert_error(response, 409, "card_in_use")
    assert detail["decks"] == [
        {"id": alpha["id"], "name": "Alpha"},
        {"id": beta["id"], "name": "beta"},
    ]
    assert after_removal.status_code == 204


async def test_origin_change_must_fit_the_decks_holding_the_card(
    client: AsyncClient, alice: AuthedUser
) -> None:
    swamp = await create_origin(client, alice)
    forest_id = await system_origin_id(client, alice, "forest")
    neutral_id = await system_origin_id(client, alice)
    toad = await create_card(client, alice, name="Toad", origin_id=swamp["id"])
    deck = await create_deck(client, alice, [(toad, 2)], name="Bog", origin_id=swamp["id"])
    url = f"/api/cards/{toad['id']}"

    to_forest = await client.patch(url, json={"origin_id": forest_id}, headers=alice.headers)
    to_neutral = await client.patch(url, json={"origin_id": neutral_id}, headers=alice.headers)
    back_to_swamp = await client.patch(url, json={"origin_id": swamp["id"]}, headers=alice.headers)

    detail = assert_error(to_forest, 409, "card_in_use")
    assert detail["decks"] == [{"id": deck["id"], "name": "Bog"}]
    assert to_neutral.status_code == 200  # neutral cards fit any deck
    assert back_to_swamp.status_code == 200


async def test_a_neutral_card_in_a_neutral_deck_keeps_its_origin(
    client: AsyncClient, alice: AuthedUser
) -> None:
    forest_id = await system_origin_id(client, alice, "forest")
    wolf = await create_card(client, alice)
    await create_deck(client, alice, [(wolf, 1)])  # a neutral deck

    response = await client.patch(
        f"/api/cards/{wolf['id']}", json={"origin_id": forest_id}, headers=alice.headers
    )

    assert_error(response, 409, "card_in_use")


async def test_other_users_cards_are_hidden(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    card = await create_card(client, alice)
    url = f"/api/cards/{card['id']}"

    listed = (await client.get("/api/cards", headers=bob.headers)).json()
    get = await client.get(url, headers=bob.headers)
    patch = await client.patch(url, json={"name": "Mine"}, headers=bob.headers)
    delete = await client.delete(url, headers=bob.headers)

    assert listed == {"items": [], "total": 0}
    assert_error(get, 404, "card_not_found")
    assert_error(patch, 404, "card_not_found")
    assert_error(delete, 404, "card_not_found")


# --- list ---


async def test_list_filters_and_pagination(client: AsyncClient, alice: AuthedUser) -> None:
    origin = await create_origin(client, alice)
    group = await create_group(client, alice, "Beasts")
    wolf = await create_card(client, alice, name="Wolf", group_id=group["id"])
    bolt = await create_card(
        client, alice, name="Bolt", kind="spell", hp=None, dmg=2, abilities=[{"key": "deal_damage"}]
    )
    bear = await create_card(client, alice, name="Bear", origin_id=origin["id"])

    async def names(query: str) -> list[str]:
        response = await client.get(f"/api/cards?{query}", headers=alice.headers)
        assert response.status_code == 200, response.text
        return [card["name"] for card in response.json()["items"]]

    assert await names("") == ["Bear", "Bolt", "Wolf"]  # newest first
    assert await names("kind=spell") == ["Bolt"]
    assert await names(f"origin_id={origin['id']}") == ["Bear"]
    assert await names(f"group_id={group['id']}") == ["Wolf"]
    assert await names("ungrouped=true") == ["Bear", "Bolt"]
    assert await names("limit=1&offset=1") == ["Bolt"]

    page = (await client.get("/api/cards?limit=2", headers=alice.headers)).json()
    assert page["total"] == 3
    assert [card["id"] for card in page["items"]] == [bear["id"], bolt["id"]]
    assert wolf["group_id"] == group["id"]


@pytest.mark.parametrize(
    "query", ["limit=0", "limit=101", "offset=-1", f"group_id={uuid4()}&ungrouped=true"]
)
async def test_list_rejects_bad_query(client: AsyncClient, alice: AuthedUser, query: str) -> None:
    response = await client.get(f"/api/cards?{query}", headers=alice.headers)

    assert response.status_code == 422


# --- suggest-cost ---


@pytest.mark.parametrize(
    ("body", "suggested"),
    [
        ({"kind": "creature", "hp": 3, "dmg": 3, "abilities": [TAUNT]}, 4),
        ({"kind": "spell", "dmg": -3, "abilities": [{"key": "heal"}]}, 2),
        ({"kind": "spell", "abilities": [{"key": "buff", "params": {"dmg": 2, "hp": 2}}]}, 2),
    ],
)
async def test_suggest_cost(
    client: AsyncClient, alice: AuthedUser, body: dict[str, Any], suggested: int
) -> None:
    response = await client.post("/api/cards/suggest-cost", json=body, headers=alice.headers)

    assert response.status_code == 200
    assert response.json() == {"suggested_mana_cost": suggested}


async def test_suggest_cost_uses_the_kind_rules(client: AsyncClient, alice: AuthedUser) -> None:
    body = {"kind": "creature", "hp": 3, "abilities": [TAUNT]}

    response = await client.post("/api/cards/suggest-cost", json=body, headers=alice.headers)

    assert_error(response, 422, "invalid_stats")


async def test_suggest_cost_needs_login(client: AsyncClient) -> None:
    response = await client.post("/api/cards/suggest-cost", json={"kind": "creature"})

    assert_error(response, 401, "not_authenticated")
