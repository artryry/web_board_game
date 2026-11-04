from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.engine.registry import FieldEffectModule, ModuleRef
from app.services.common import normalize_module_refs
from tests.helpers import (
    AuthedUser,
    assert_error,
    create_card,
    create_origin,
    system_origin_id,
)

SYSTEM_KEYS = {"neutral", "forest", "volcano", "ocean", "mountain"}


async def test_origins_need_login(client: AsyncClient) -> None:
    assert_error(await client.get("/api/origins"), 401, "not_authenticated")


# --- system origins ---


async def test_system_origins_are_seeded_and_listed_first(
    client: AsyncClient, alice: AuthedUser
) -> None:
    await create_origin(client, alice, name="Aardvark land")

    response = await client.get("/api/origins", headers=alice.headers)

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 6
    system = body["items"][:5]
    assert {origin["system_key"] for origin in system} == SYSTEM_KEYS
    assert all(origin["is_system"] for origin in system)
    assert body["items"][5]["name"] == "Aardvark land"


async def test_system_origin_effects_still_validate(client: AsyncClient, alice: AuthedUser) -> None:
    # The seed migration stores literal JSON; this catches drift from the registry.
    body = (await client.get("/api/origins", headers=alice.headers)).json()

    for origin in body["items"]:
        refs = [ModuleRef.model_validate(effect) for effect in origin["field_effects"]]
        assert normalize_module_refs(FieldEffectModule, refs) == origin["field_effects"]


async def test_system_origins_are_read_only(client: AsyncClient, alice: AuthedUser) -> None:
    forest_id = await system_origin_id(client, alice, "forest")

    get = await client.get(f"/api/origins/{forest_id}", headers=alice.headers)
    patch = await client.patch(
        f"/api/origins/{forest_id}", json={"name": "Mine"}, headers=alice.headers
    )
    delete = await client.delete(f"/api/origins/{forest_id}", headers=alice.headers)

    assert get.status_code == 200
    assert_error(patch, 403, "system_origin_read_only")
    assert_error(delete, 403, "system_origin_read_only")


# --- create, read, update, delete ---


async def test_create_origin_fills_param_defaults(client: AsyncClient, alice: AuthedUser) -> None:
    origin = await create_origin(
        client,
        alice,
        name="  Swamp  ",
        field_effects=[{"key": "stat_bonus", "params": {"hp": 1}}, {"key": "free_move"}],
    )

    assert origin["name"] == "Swamp"
    assert origin["color"] == "bluish_green"
    assert origin["icon"] == "droplet"
    assert origin["field_effects"] == [
        {"key": "stat_bonus", "params": {"applies_to": "own_origin", "hp": 1, "dmg": 0}},
        {"key": "free_move", "params": {}},
    ]
    assert origin["is_system"] is False
    assert origin["system_key"] is None
    assert origin["background_art_url"] is None


async def test_get_own_origin(client: AsyncClient, alice: AuthedUser) -> None:
    origin = await create_origin(client, alice)

    response = await client.get(f"/api/origins/{origin['id']}", headers=alice.headers)

    assert response.status_code == 200
    assert response.json() == origin


async def test_unknown_origin_is_404(client: AsyncClient, alice: AuthedUser) -> None:
    response = await client.get(f"/api/origins/{uuid4()}", headers=alice.headers)

    assert_error(response, 404, "origin_not_found")


async def test_patch_changes_only_sent_fields(client: AsyncClient, alice: AuthedUser) -> None:
    origin = await create_origin(client, alice, field_effects=[{"key": "free_move"}])

    response = await client.patch(
        f"/api/origins/{origin['id']}",
        json={"name": "Bog", "field_effects": [{"key": "spell_power", "params": {"amount": 2}}]},
        headers=alice.headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Bog"
    assert body["color"] == origin["color"]
    assert body["field_effects"] == [{"key": "spell_power", "params": {"amount": 2}}]


async def test_patch_rejects_null_for_required_field(
    client: AsyncClient, alice: AuthedUser
) -> None:
    origin = await create_origin(client, alice)

    response = await client.patch(
        f"/api/origins/{origin['id']}", json={"name": None}, headers=alice.headers
    )

    assert response.status_code == 422


async def test_delete_origin(client: AsyncClient, alice: AuthedUser) -> None:
    origin = await create_origin(client, alice)

    response = await client.delete(f"/api/origins/{origin['id']}", headers=alice.headers)
    after = await client.get(f"/api/origins/{origin['id']}", headers=alice.headers)

    assert response.status_code == 204
    assert_error(after, 404, "origin_not_found")


async def test_delete_origin_in_use_lists_the_cards(client: AsyncClient, alice: AuthedUser) -> None:
    origin = await create_origin(client, alice)
    wolf = await create_card(client, alice, name="Wolf", origin_id=origin["id"])
    bear = await create_card(client, alice, name="Bear", origin_id=origin["id"])

    response = await client.delete(f"/api/origins/{origin['id']}", headers=alice.headers)

    detail = assert_error(response, 409, "origin_in_use")
    assert detail["cards"] == [
        {"id": bear["id"], "name": "Bear"},
        {"id": wolf["id"], "name": "Wolf"},
    ]


# --- validation ---


@pytest.mark.parametrize(
    ("field_effects", "code"),
    [
        ([{"key": "teleport"}], "unknown_module"),
        ([{"key": "taunt"}], "unknown_module"),  # a creature feature, not a field effect
        ([{"key": "section_hp_bonus", "params": {"amount": 11}}], "invalid_params"),
        ([{"key": "free_move", "params": {"fast": True}}], "invalid_params"),
        ([{"key": "free_move"}, {"key": "free_move"}], "invalid_field_effects"),
    ],
)
async def test_field_effects_are_validated(
    client: AsyncClient, alice: AuthedUser, field_effects: list[dict[str, Any]], code: str
) -> None:
    body = {"name": "Bad", "color": "blue", "icon": "star", "field_effects": field_effects}

    response = await client.post("/api/origins", json=body, headers=alice.headers)

    assert_error(response, 422, code)


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": ""},
        {"name": "x" * 41},
        {"color": "magenta"},
        {"icon": "dragon"},
        {"field_effects": [{"key": "free_move"}] * 4},
    ],
)
async def test_origin_fields_are_bounded(
    client: AsyncClient, alice: AuthedUser, overrides: dict[str, Any]
) -> None:
    body = {"name": "Bad", "color": "blue", "icon": "star"} | overrides

    response = await client.post("/api/origins", json=body, headers=alice.headers)

    assert response.status_code == 422


# --- ownership ---


async def test_other_users_origins_are_hidden(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    origin = await create_origin(client, alice)
    url = f"/api/origins/{origin['id']}"

    listed = (await client.get("/api/origins", headers=bob.headers)).json()
    get = await client.get(url, headers=bob.headers)
    patch = await client.patch(url, json={"name": "Mine"}, headers=bob.headers)
    delete = await client.delete(url, headers=bob.headers)

    assert origin["id"] not in {item["id"] for item in listed["items"]}
    assert_error(get, 404, "origin_not_found")
    assert_error(patch, 404, "origin_not_found")
    assert_error(delete, 404, "origin_not_found")
    assert (await client.get(url, headers=alice.headers)).json()["name"] == origin["name"]
