from typing import Any

import pytest
from httpx import AsyncClient

from app.schemas.rules import RulesetDefinition
from app.services.rules_service import validate_definition
from tests.helpers import (
    AuthedUser,
    access_line,
    assert_error,
    create_ruleset,
    default_ruleset_id,
)

DEFAULT_DEFINITION = RulesetDefinition().model_dump(mode="json")
ACTION = {"key": "action_phase"}
END = {"key": "end_turn"}

# Two problems in two sections: a bound and a pipeline rule.
BROKEN = {"board": {"lanes": 9}, "turn": [ACTION]}
BROKEN_ERRORS = [(["board", "lanes"], "invalid_value"), (["turn"], "end_turn_missing")]


def paths_and_codes(errors: list[dict[str, Any]]) -> list[tuple[list[Any], str]]:
    return [(error["path"], error["code"]) for error in errors]


async def get(client: AsyncClient, user: AuthedUser, path: str) -> dict[str, Any]:
    response = await client.get(path, headers=user.headers)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


async def test_routes_need_login(client: AsyncClient) -> None:
    validate = await client.post("/api/rulesets/validate", json={"definition": {}})

    assert_error(await client.get("/api/rulesets"), 401, "not_authenticated")
    assert_error(validate, 401, "not_authenticated")


# --- the default ruleset ---


async def test_the_default_ruleset_is_listed_first(client: AsyncClient, alice: AuthedUser) -> None:
    await create_ruleset(client, alice, "Zebra")
    await create_ruleset(client, alice, "aardvark")

    body = await get(client, alice, "/api/rulesets")

    assert body["total"] == 3
    assert [ruleset["name"] for ruleset in body["items"]] == ["Default", "aardvark", "Zebra"]
    default = body["items"][0]
    assert (default["is_system"], default["system_key"], default["share_code"]) == (
        True,
        "default",
        None,
    )
    assert [ruleset["is_system"] for ruleset in body["items"][1:]] == [False, False]


async def test_the_seeded_default_still_validates(client: AsyncClient, alice: AuthedUser) -> None:
    # The seed migration stores literal JSON; this catches drift from the schema and registry.
    default_id = await default_ruleset_id(client, alice)
    default = await get(client, alice, f"/api/rulesets/{default_id}")

    result, errors = validate_definition(default["definition"])

    assert default["definition"] == DEFAULT_DEFINITION
    assert errors == []
    assert result == RulesetDefinition()


async def test_the_default_ruleset_is_read_only(client: AsyncClient, alice: AuthedUser) -> None:
    path = f"/api/rulesets/{await default_ruleset_id(client, alice)}"

    patch = await client.patch(path, json={"name": "Mine"}, headers=alice.headers)
    delete = await client.delete(path, headers=alice.headers)

    assert_error(patch, 403, "system_ruleset_read_only")
    assert_error(delete, 403, "system_ruleset_read_only")
    assert (await get(client, alice, path))["name"] == "Default"


async def test_copy_the_default_ruleset(client: AsyncClient, alice: AuthedUser) -> None:
    default = await get(client, alice, f"/api/rulesets/{await default_ruleset_id(client, alice)}")

    copy = await create_ruleset(client, alice, "My rules", **default["definition"])

    assert copy["id"] != default["id"]
    assert copy["definition"] == default["definition"]
    assert (copy["is_system"], copy["system_key"]) == (False, None)


# --- create, read, update, delete ---


async def test_create_a_ruleset(client: AsyncClient, alice: AuthedUser) -> None:
    created = await create_ruleset(
        client, alice, "  Big decks ", deck={"size": 40}, turn=[ACTION, END]
    )

    assert created["name"] == "Big decks"
    assert (created["is_system"], created["system_key"], created["share_code"]) == (
        False,
        None,
        None,
    )
    # Normalized: the sections that weren't sent and every param are filled in.
    assert created["definition"] == DEFAULT_DEFINITION | {
        "deck": {"size": 40, "max_copies": 2, "allow_neutral": True},
        "turn": [DEFAULT_DEFINITION["turn"][2], DEFAULT_DEFINITION["turn"][3]],
    }
    assert await get(client, alice, f"/api/rulesets/{created['id']}") == created


@pytest.mark.parametrize("name", ["", "   ", "x" * 41])
async def test_names_are_content_names(client: AsyncClient, alice: AuthedUser, name: str) -> None:
    body = {"name": name, "definition": {}}

    response = await client.post("/api/rulesets", json=body, headers=alice.headers)

    assert response.status_code == 422


async def test_rename_keeps_the_definition(client: AsyncClient, alice: AuthedUser) -> None:
    ruleset = await create_ruleset(client, alice, mana={"max": 7})

    response = await client.patch(
        f"/api/rulesets/{ruleset['id']}", json={"name": "Renamed"}, headers=alice.headers
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["name"] == "Renamed"
    assert updated["definition"] == ruleset["definition"]
    assert updated["updated_at"] > ruleset["updated_at"]


async def test_a_new_definition_replaces_the_whole_one(
    client: AsyncClient, alice: AuthedUser
) -> None:
    ruleset = await create_ruleset(client, alice, mana={"max": 7})

    response = await client.patch(
        f"/api/rulesets/{ruleset['id']}",
        json={"definition": {"board": {"lanes": 5}}},
        headers=alice.headers,
    )

    assert response.status_code == 200, response.text
    definition = response.json()["definition"]
    assert definition["board"]["lanes"] == 5
    # Not merged: mana is back to its default.
    assert definition["mana"] == DEFAULT_DEFINITION["mana"]


@pytest.mark.parametrize("body", [{"name": None}, {"definition": None}])
async def test_patch_rejects_nulls(
    client: AsyncClient, alice: AuthedUser, body: dict[str, Any]
) -> None:
    ruleset = await create_ruleset(client, alice)

    response = await client.patch(
        f"/api/rulesets/{ruleset['id']}", json=body, headers=alice.headers
    )

    assert response.status_code == 422


async def test_delete_a_ruleset(client: AsyncClient, alice: AuthedUser) -> None:
    ruleset = await create_ruleset(client, alice)
    path = f"/api/rulesets/{ruleset['id']}"

    deleted = await client.delete(path, headers=alice.headers)

    assert deleted.status_code == 204
    assert_error(await client.get(path, headers=alice.headers), 404, "ruleset_not_found")
    assert (await get(client, alice, "/api/rulesets"))["total"] == 1


async def test_unknown_ruleset(client: AsyncClient, alice: AuthedUser) -> None:
    path = "/api/rulesets/00000000-0000-0000-0000-000000000000"

    assert_error(await client.get(path, headers=alice.headers), 404, "ruleset_not_found")


# --- validation ---


async def test_an_invalid_save_is_rejected_with_every_error(
    client: AsyncClient, alice: AuthedUser, logs: list[dict[str, Any]]
) -> None:
    body = {"name": "Broken", "definition": BROKEN}

    response = await client.post("/api/rulesets", json=body, headers=alice.headers)

    detail = assert_error(response, 422, "invalid_ruleset")
    assert paths_and_codes(detail["errors"]) == BROKEN_ERRORS
    assert all(error["message"] for error in detail["errors"])
    assert access_line(logs, "/api/rulesets")["error_code"] == "invalid_ruleset"
    assert (await get(client, alice, "/api/rulesets"))["total"] == 1


async def test_an_invalid_update_changes_nothing(client: AsyncClient, alice: AuthedUser) -> None:
    ruleset = await create_ruleset(client, alice)
    path = f"/api/rulesets/{ruleset['id']}"

    response = await client.patch(
        path, json={"name": "Broken", "definition": BROKEN}, headers=alice.headers
    )

    detail = assert_error(response, 422, "invalid_ruleset")
    assert paths_and_codes(detail["errors"]) == BROKEN_ERRORS
    assert await get(client, alice, path) == ruleset


async def test_validate_an_invalid_definition(client: AsyncClient, alice: AuthedUser) -> None:
    response = await client.post(
        "/api/rulesets/validate", json={"definition": BROKEN}, headers=alice.headers
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["valid"], body["definition"]) == (False, None)
    assert paths_and_codes(body["errors"]) == BROKEN_ERRORS


async def test_validate_returns_the_normalized_definition(
    client: AsyncClient, alice: AuthedUser
) -> None:
    response = await client.post(
        "/api/rulesets/validate", json={"definition": {}}, headers=alice.headers
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"valid": True, "errors": [], "definition": DEFAULT_DEFINITION}


async def test_the_definition_must_be_a_json_object(client: AsyncClient, alice: AuthedUser) -> None:
    response = await client.post(
        "/api/rulesets/validate", json={"definition": [1, 2]}, headers=alice.headers
    )

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


# --- ownership ---


async def test_another_users_ruleset_is_not_found(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    ruleset = await create_ruleset(client, alice)
    path = f"/api/rulesets/{ruleset['id']}"

    get_response = await client.get(path, headers=bob.headers)
    patch = await client.patch(path, json={"name": "Mine"}, headers=bob.headers)
    delete = await client.delete(path, headers=bob.headers)

    assert_error(get_response, 404, "ruleset_not_found")
    assert_error(patch, 404, "ruleset_not_found")
    assert_error(delete, 404, "ruleset_not_found")
    names = [r["name"] for r in (await get(client, bob, "/api/rulesets"))["items"]]
    assert names == ["Default"]
