"""The Rooms REST routes (backend_plan §8): create, join by code, read, and the lobby's decks."""

from typing import Any

import pytest
from httpx import AsyncClient
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.helpers import (
    AuthedUser,
    assert_error,
    create_card,
    create_deck,
    default_ruleset_id,
    logged,
    register_user,
)
from tests.room_helpers import create_room, join_room, playable_deck, small_ruleset

pytestmark = pytest.mark.usefixtures("rooms")


def _player(user: AuthedUser, username: str, is_host: bool) -> dict[str, Any]:
    return {
        "user_id": str(user.id),
        "username": username,
        "is_host": is_host,
        "connected": False,
        "has_deck": False,
        "ready": False,
        "seat": None,
        "away_since": None,
    }


# --- Create ---


async def test_create_a_room_with_a_copy_of_the_ruleset(
    client: AsyncClient, alice: AuthedUser, logs: list[dict[str, Any]]
) -> None:
    ruleset_id = await small_ruleset(client, alice)

    response = await client.post(
        "/api/rooms", json={"ruleset_id": ruleset_id}, headers=alice.headers
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert len(body["code"]) == 6
    assert body["status"] == "lobby"
    assert body["ruleset"]["id"] == ruleset_id
    assert body["ruleset"]["name"] == "Blitz"
    assert body["ruleset"]["definition"]["deck"]["size"] == 10
    assert body["players"] == [_player(alice, "alice", is_host=True)]
    assert body["my_deck"] is None
    (line,) = logged(logs, "room.created")
    assert (line["room_code"], str(line["ruleset_id"])) == (body["code"], ruleset_id)


async def test_later_edits_to_the_ruleset_dont_reach_the_room(
    client: AsyncClient, alice: AuthedUser
) -> None:
    ruleset_id = await small_ruleset(client, alice)
    code = await create_room(client, alice, ruleset_id)

    await client.delete(f"/api/rulesets/{ruleset_id}", headers=alice.headers)

    response = await client.get(f"/api/rooms/{code}", headers=alice.headers)
    assert response.json()["ruleset"]["definition"]["deck"]["size"] == 10


async def test_the_default_ruleset_makes_a_room(client: AsyncClient, alice: AuthedUser) -> None:
    ruleset_id = await default_ruleset_id(client, alice)

    response = await client.post(
        "/api/rooms", json={"ruleset_id": ruleset_id}, headers=alice.headers
    )

    assert response.status_code == 201


async def test_another_users_ruleset_is_not_found(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    ruleset_id = await small_ruleset(client, bob)

    response = await client.post(
        "/api/rooms", json={"ruleset_id": ruleset_id}, headers=alice.headers
    )

    assert_error(response, 404, "ruleset_not_found")


async def test_a_stored_ruleset_that_no_longer_validates_is_refused(
    client: AsyncClient, alice: AuthedUser, db: AsyncSession
) -> None:
    ruleset_id = await small_ruleset(client, alice)
    # As if a phase module had been removed since the ruleset was saved.
    await db.execute(
        text(
            "UPDATE rulesets SET definition = "
            "jsonb_set(definition, '{turn,0,key}', '\"no_such_phase\"') WHERE id = :id"
        ),
        {"id": ruleset_id},
    )

    response = await client.post(
        "/api/rooms", json={"ruleset_id": ruleset_id}, headers=alice.headers
    )

    detail = assert_error(response, 422, "invalid_ruleset")
    assert detail["errors"][0]["code"] == "unknown_module"


async def test_the_room_lives_24_hours_in_redis(
    client: AsyncClient, alice: AuthedUser, redis: Redis
) -> None:
    code = await create_room(client, alice, await small_ruleset(client, alice))

    ttl = await redis.ttl(f"room:{code}")

    assert 24 * 3600 - 60 < ttl <= 24 * 3600


async def test_the_routes_need_a_login(client: AsyncClient) -> None:
    response = await client.post("/api/rooms/join", json={"code": "ABCDEF"})

    assert_error(response, 401, "not_authenticated")


# --- Join ---


async def test_join_by_code_in_any_case(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser, logs: list[dict[str, Any]]
) -> None:
    code = await create_room(client, alice, await small_ruleset(client, alice))

    body = await join_room(client, bob, f"  {code.lower()} ")

    assert body["players"] == [
        _player(alice, "alice", is_host=True),
        _player(bob, "bob", is_host=False),
    ]
    (line,) = logged(logs, "room.joined")
    assert line["room_code"] == code


async def test_a_member_joining_again_gets_the_same_answer(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    code = await create_room(client, alice, await small_ruleset(client, alice))
    first = await join_room(client, bob, code)

    assert await join_room(client, bob, code) == first
    # Neither has a deck yet, so the host sees what the guest sees.
    assert await join_room(client, alice, code) == first


async def test_a_third_player_finds_the_room_full(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    code = await create_room(client, alice, await small_ruleset(client, alice))
    await join_room(client, bob, code)
    carol = await register_user(client, "carol")

    response = await client.post("/api/rooms/join", json={"code": code}, headers=carol.headers)

    assert_error(response, 409, "room_full")


async def test_an_unknown_room_is_not_found(client: AsyncClient, alice: AuthedUser) -> None:
    join = await client.post("/api/rooms/join", json={"code": "ZZZZZZ"}, headers=alice.headers)
    get = await client.get("/api/rooms/ZZZZZZ", headers=alice.headers)

    assert_error(join, 404, "room_not_found")
    assert_error(get, 404, "room_not_found")


# --- Read ---


async def test_only_members_can_read_a_room(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    code = await create_room(client, alice, await small_ruleset(client, alice))

    before = await client.get(f"/api/rooms/{code}", headers=bob.headers)
    await join_room(client, bob, code)
    after = await client.get(f"/api/rooms/{code.lower()}", headers=bob.headers)

    assert_error(before, 404, "room_not_found")
    assert after.status_code == 200
    assert after.json()["code"] == code


# --- The lobby's decks ---


async def test_the_users_decks_with_their_problems_under_the_rooms_rules(
    client: AsyncClient, alice: AuthedUser
) -> None:
    code = await create_room(client, alice, await small_ruleset(client, alice))
    playable = await playable_deck(client, alice, "Wolves")
    card = await create_card(client, alice, name="Lone")
    small = await create_deck(client, alice, [(card, 3)], name="Small")

    response = await client.get(f"/api/rooms/{code}/decks", headers=alice.headers)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 2
    # Newest first, like /api/decks.
    assert [deck["id"] for deck in body["items"]] == [small["id"], playable]
    assert body["items"][0] == {
        "id": small["id"],
        "name": "Small",
        "origin_id": small["origin_id"],
        "card_count": 3,
        "problems": [
            {"kind": "size", "count": 3, "size": 10},
            {"kind": "copies", "max": 2, "cards": [{"id": card["id"], "name": "Lone"}]},
        ],
    }
    assert body["items"][1]["problems"] == []


async def test_the_deck_list_is_paginated(client: AsyncClient, alice: AuthedUser) -> None:
    code = await create_room(client, alice, await small_ruleset(client, alice))
    await playable_deck(client, alice, "Wolves")
    await playable_deck(client, alice, "Bears")

    response = await client.get(f"/api/rooms/{code}/decks?limit=1", headers=alice.headers)

    body = response.json()
    assert (body["total"], len(body["items"]), body["items"][0]["name"]) == (2, 1, "Bears")


async def test_only_members_see_the_deck_list(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    code = await create_room(client, alice, await small_ruleset(client, alice))

    response = await client.get(f"/api/rooms/{code}/decks", headers=bob.headers)

    assert_error(response, 404, "room_not_found")
