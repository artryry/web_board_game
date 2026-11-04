from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.helpers import AuthedUser, assert_error, create_card, create_group


async def test_groups_need_login(client: AsyncClient) -> None:
    assert_error(await client.get("/api/card-groups"), 401, "not_authenticated")


async def test_create_and_list_groups(client: AsyncClient, alice: AuthedUser) -> None:
    beasts = await create_group(client, alice, "  Beasts  ")
    await create_group(client, alice, "aquatic")

    response = await client.get("/api/card-groups", headers=alice.headers)

    assert beasts["name"] == "Beasts"
    assert beasts["card_count"] == 0
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert [group["name"] for group in body["items"]] == ["aquatic", "Beasts"]  # by name


async def test_card_count(client: AsyncClient, alice: AuthedUser) -> None:
    group = await create_group(client, alice, "Beasts")
    await create_card(client, alice, group_id=group["id"])
    await create_card(client, alice, group_id=group["id"])
    await create_card(client, alice)

    get = await client.get(f"/api/card-groups/{group['id']}", headers=alice.headers)
    listed = await client.get("/api/card-groups", headers=alice.headers)

    assert get.json()["card_count"] == 2
    assert listed.json()["items"][0]["card_count"] == 2


async def test_names_are_unique_per_user_ignoring_case(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    await create_group(client, alice, "Beasts")

    duplicate = await client.post(
        "/api/card-groups", json={"name": "BEASTS"}, headers=alice.headers
    )
    other_user = await client.post("/api/card-groups", json={"name": "Beasts"}, headers=bob.headers)

    assert_error(duplicate, 409, "group_name_taken")
    assert other_user.status_code == 201


async def test_rename_group(client: AsyncClient, alice: AuthedUser) -> None:
    group = await create_group(client, alice, "Beasts")
    await create_group(client, alice, "Spells")
    url = f"/api/card-groups/{group['id']}"

    to_taken = await client.patch(url, json={"name": "spells"}, headers=alice.headers)
    change_case = await client.patch(url, json={"name": "BEASTS"}, headers=alice.headers)

    assert_error(to_taken, 409, "group_name_taken")
    assert change_case.status_code == 200
    assert change_case.json()["name"] == "BEASTS"


async def test_delete_group_keeps_its_cards(client: AsyncClient, alice: AuthedUser) -> None:
    group = await create_group(client, alice, "Beasts")
    card = await create_card(client, alice, group_id=group["id"])

    response = await client.delete(f"/api/card-groups/{group['id']}", headers=alice.headers)
    after = await client.get(f"/api/card-groups/{group['id']}", headers=alice.headers)
    card_after = await client.get(f"/api/cards/{card['id']}", headers=alice.headers)
    ungrouped = await client.get("/api/cards?ungrouped=true", headers=alice.headers)

    assert response.status_code == 204
    assert_error(after, 404, "group_not_found")
    assert card_after.json()["group_id"] is None
    assert [item["id"] for item in ungrouped.json()["items"]] == [card["id"]]


async def test_move_card_between_groups(client: AsyncClient, alice: AuthedUser) -> None:
    first = await create_group(client, alice, "First")
    second = await create_group(client, alice, "Second")
    card = await create_card(client, alice, group_id=first["id"])
    url = f"/api/cards/{card['id']}"

    moved = await client.patch(url, json={"group_id": second["id"]}, headers=alice.headers)
    removed = await client.patch(url, json={"group_id": None}, headers=alice.headers)

    assert moved.json()["group_id"] == second["id"]
    assert removed.json()["group_id"] is None


@pytest.mark.parametrize("name", ["", "   ", "x" * 41])
async def test_name_is_bounded(client: AsyncClient, alice: AuthedUser, name: str) -> None:
    response = await client.post("/api/card-groups", json={"name": name}, headers=alice.headers)

    assert response.status_code == 422


async def test_other_users_groups_are_hidden(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    group = await create_group(client, alice, "Beasts")
    url = f"/api/card-groups/{group['id']}"

    listed = (await client.get("/api/card-groups", headers=bob.headers)).json()
    get = await client.get(url, headers=bob.headers)
    patch = await client.patch(url, json={"name": "Mine"}, headers=bob.headers)
    delete = await client.delete(url, headers=bob.headers)

    assert listed == {"items": [], "total": 0}
    assert_error(get, 404, "group_not_found")
    assert_error(patch, 404, "group_not_found")
    assert_error(delete, 404, "group_not_found")


async def test_card_group_must_be_own(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    bobs_group = await create_group(client, bob, "Bob's")
    card = await create_card(client, alice)

    for group_id in (bobs_group["id"], str(uuid4())):
        response = await client.patch(
            f"/api/cards/{card['id']}", json={"group_id": group_id}, headers=alice.headers
        )
        assert_error(response, 422, "invalid_group")
