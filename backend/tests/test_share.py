from typing import Any

from httpx import AsyncClient

from app.core.codes import CODE_ALPHABET
from tests.helpers import (
    PUBLIC_BASE_URL,
    AuthedUser,
    FakeS3,
    assert_error,
    create_card,
    create_deck,
    create_group,
    create_origin,
    share,
    system_origin_id,
    uploaded_art,
)


async def get(client: AsyncClient, user: AuthedUser, path: str) -> dict[str, Any]:
    response = await client.get(path, headers=user.headers)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


async def import_code(client: AsyncClient, user: AuthedUser, code: str) -> dict[str, Any]:
    response = await client.post(f"/api/share/{code}/import", headers=user.headers)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


async def custom_origins(client: AsyncClient, user: AuthedUser) -> list[dict[str, Any]]:
    body = await get(client, user, "/api/origins")
    return [origin for origin in body["items"] if not origin["is_system"]]


async def swamp_deck(
    client: AsyncClient, alice: AuthedUser, fake_s3: FakeS3
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Alice's "Bog" deck: two Swamp cards (one with art) and a neutral one."""
    swamp = await create_origin(
        client,
        alice,
        name="Swamp",
        field_effects=[{"key": "free_move"}],
        background_art_key=uploaded_art(fake_s3, "origin-art", alice),
    )
    toad = await create_card(
        client,
        alice,
        name="Toad",
        mana_cost=3,
        origin_id=swamp["id"],
        art_key=uploaded_art(fake_s3, "card-art", alice),
    )
    eel = await create_card(client, alice, name="Eel", mana_cost=1, origin_id=swamp["id"])
    wolf = await create_card(client, alice, name="Wolf", mana_cost=2)
    deck = await create_deck(
        client, alice, [(toad, 2), (eel, 3), (wolf, 1)], name="Bog", origin_id=swamp["id"]
    )
    return swamp, deck


async def test_share_routes_need_login(client: AsyncClient) -> None:
    assert_error(await client.get("/api/share/ABCDEFGHJK"), 401, "not_authenticated")
    assert_error(await client.post("/api/share/ABCDEFGHJK/import"), 401, "not_authenticated")


# --- share codes ---


async def test_sharing_a_deck_twice_gives_the_same_code(
    client: AsyncClient, alice: AuthedUser
) -> None:
    deck = await create_deck(client, alice, [])
    path = f"/api/decks/{deck['id']}"

    first = await share(client, alice, path)
    second = await share(client, alice, path)

    assert first == second
    assert len(first) == 10
    assert set(first) <= set(CODE_ALPHABET)
    assert (await get(client, alice, path))["share_code"] == first
    assert (await get(client, alice, "/api/decks"))["items"][0]["share_code"] == first


async def test_sharing_a_group_twice_gives_the_same_code(
    client: AsyncClient, alice: AuthedUser
) -> None:
    group = await create_group(client, alice, "Beasts")
    path = f"/api/card-groups/{group['id']}"

    first = await share(client, alice, path)
    second = await share(client, alice, path)

    assert first == second
    assert (await get(client, alice, path))["share_code"] == first


async def test_revoke_then_share_gives_a_new_code(client: AsyncClient, alice: AuthedUser) -> None:
    deck = await create_deck(client, alice, [])
    path = f"/api/decks/{deck['id']}"
    old = await share(client, alice, path)

    revoked = await client.delete(f"{path}/share", headers=alice.headers)
    revoked_again = await client.delete(f"{path}/share", headers=alice.headers)
    old_preview = await client.get(f"/api/share/{old}", headers=alice.headers)
    after = await get(client, alice, path)
    new = await share(client, alice, path)

    assert revoked.status_code == 204
    assert revoked_again.status_code == 204
    assert_error(old_preview, 404, "share_not_found")
    assert after["share_code"] is None
    assert new != old


async def test_revoke_a_group_share(client: AsyncClient, alice: AuthedUser) -> None:
    group = await create_group(client, alice, "Beasts")
    path = f"/api/card-groups/{group['id']}"
    code = await share(client, alice, path)

    revoked = await client.delete(f"{path}/share", headers=alice.headers)
    preview = await client.get(f"/api/share/{code}", headers=alice.headers)

    assert revoked.status_code == 204
    assert_error(preview, 404, "share_not_found")


async def test_deleting_the_target_removes_its_code(client: AsyncClient, alice: AuthedUser) -> None:
    deck = await create_deck(client, alice, [])
    group = await create_group(client, alice, "Beasts")
    deck_code = await share(client, alice, f"/api/decks/{deck['id']}")
    group_code = await share(client, alice, f"/api/card-groups/{group['id']}")

    await client.delete(f"/api/decks/{deck['id']}", headers=alice.headers)
    await client.delete(f"/api/card-groups/{group['id']}", headers=alice.headers)

    for code in (deck_code, group_code):
        response = await client.get(f"/api/share/{code}", headers=alice.headers)
        assert_error(response, 404, "share_not_found")


async def test_only_the_owner_can_share(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    deck = await create_deck(client, alice, [])
    group = await create_group(client, alice, "Beasts")
    deck_path = f"/api/decks/{deck['id']}/share"
    group_path = f"/api/card-groups/{group['id']}/share"

    assert_error(await client.post(deck_path, headers=bob.headers), 404, "deck_not_found")
    assert_error(await client.delete(deck_path, headers=bob.headers), 404, "deck_not_found")
    assert_error(await client.post(group_path, headers=bob.headers), 404, "group_not_found")
    assert_error(await client.delete(group_path, headers=bob.headers), 404, "group_not_found")


async def test_single_cards_have_no_share_code(client: AsyncClient, alice: AuthedUser) -> None:
    card = await create_card(client, alice)

    response = await client.post(f"/api/cards/{card['id']}/share", headers=alice.headers)

    assert response.status_code in (404, 405)


async def test_unknown_code(client: AsyncClient, alice: AuthedUser) -> None:
    preview = await client.get("/api/share/ABCDEFGHJK", headers=alice.headers)
    imported = await client.post("/api/share/not-a-code/import", headers=alice.headers)

    assert_error(preview, 404, "share_not_found")
    assert_error(imported, 404, "share_not_found")


# --- preview ---


async def test_preview_a_deck(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser, fake_s3: FakeS3
) -> None:
    swamp, deck = await swamp_deck(client, alice, fake_s3)
    code = await share(client, alice, f"/api/decks/{deck['id']}")

    preview = await get(client, bob, f"/api/share/{code.lower()}")

    assert preview["kind"] == "deck"
    assert preview["code"] == code
    assert preview["name"] == "Bog"
    assert preview["author"] == "alice"
    assert preview["origin"] == swamp
    assert preview["origin"]["background_art_url"].startswith(PUBLIC_BASE_URL)
    assert preview["cards"] == deck["cards"]
    assert preview["cards"][2]["card"]["art_url"].startswith(PUBLIC_BASE_URL)
    assert preview["card_count"] == 6


async def test_preview_shows_the_current_content(client: AsyncClient, alice: AuthedUser) -> None:
    deck = await create_deck(client, alice, [], name="Before")
    code = await share(client, alice, f"/api/decks/{deck['id']}")

    await client.patch(f"/api/decks/{deck['id']}", json={"name": "After"}, headers=alice.headers)

    assert (await get(client, alice, f"/api/share/{code}"))["name"] == "After"


async def test_preview_a_group(client: AsyncClient, alice: AuthedUser, bob: AuthedUser) -> None:
    swamp = await create_origin(client, alice, name="Swamp")
    group = await create_group(client, alice, "Mix")
    toad = await create_card(
        client, alice, name="Toad", mana_cost=3, origin_id=swamp["id"], group_id=group["id"]
    )
    wolf = await create_card(client, alice, name="Wolf", mana_cost=1, group_id=group["id"])
    await create_card(client, alice, name="Elsewhere")  # not in the group
    code = await share(client, alice, f"/api/card-groups/{group['id']}")

    preview = await get(client, bob, f"/api/share/{code}")

    assert preview["kind"] == "card_group"
    assert preview["name"] == "Mix"
    assert preview["author"] == "alice"
    assert [origin["name"] for origin in preview["origins"]] == ["Neutral", "Swamp"]
    assert preview["cards"] == [{"card": wolf, "count": 1}, {"card": toad, "count": 1}]
    assert preview["card_count"] == 2


# --- import ---


async def test_import_a_deck(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser, fake_s3: FakeS3
) -> None:
    swamp, source = await swamp_deck(client, alice, fake_s3)
    neutral_id = await system_origin_id(client, bob)
    code = await share(client, alice, f"/api/decks/{source['id']}")

    result = await import_code(client, bob, code)

    assert result["kind"] == "deck"
    deck = result["deck"]
    assert deck == await get(client, bob, f"/api/decks/{deck['id']}")
    assert deck["id"] != source["id"]
    assert deck["name"] == "Bog"
    assert deck["share_code"] is None
    assert deck["card_count"] == 6

    # The custom origin is copied once, although two cards and the deck use it.
    (origin,) = await custom_origins(client, bob)
    assert origin["id"] != swamp["id"]
    assert {key: origin[key] for key in ("name", "color", "icon", "field_effects")} == {
        key: swamp[key] for key in ("name", "color", "icon", "field_effects")
    }
    assert origin["background_art_key"] == swamp["background_art_key"]
    assert deck["origin_id"] == origin["id"]

    # The cards are copies in a new group named after the deck.
    (group,) = (await get(client, bob, "/api/card-groups"))["items"]
    assert (group["name"], group["card_count"]) == ("Bog", 3)
    for copied, original in zip(deck["cards"], source["cards"], strict=True):
        card = copied["card"]
        assert copied["count"] == original["count"]
        assert card["id"] != original["card"]["id"]
        assert card["group_id"] == group["id"]
        assert card["art_key"] == original["card"]["art_key"]
        expected_origin = neutral_id if original["card"]["name"] == "Wolf" else origin["id"]
        assert card["origin_id"] == expected_origin
        same_fields = ("kind", "name", "mana_cost", "hp", "dmg", "abilities", "art_url")
        assert {key: card[key] for key in same_fields} == {
            key: original["card"][key] for key in same_fields
        }


async def test_system_origins_are_not_copied(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    forest_id = await system_origin_id(client, alice, "forest")
    elk = await create_card(client, alice, name="Elk", origin_id=forest_id)
    deck = await create_deck(client, alice, [(elk, 2)], origin_id=forest_id)
    code = await share(client, alice, f"/api/decks/{deck['id']}")

    imported = (await import_code(client, bob, code))["deck"]

    assert imported["origin_id"] == forest_id
    assert imported["cards"][0]["card"]["origin_id"] == forest_id
    assert await custom_origins(client, bob) == []


async def test_importing_an_empty_deck_makes_no_group(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    deck = await create_deck(client, alice, [], name="Empty")
    code = await share(client, alice, f"/api/decks/{deck['id']}")

    imported = (await import_code(client, bob, code))["deck"]

    assert (imported["name"], imported["cards"]) == ("Empty", [])
    assert (await get(client, bob, "/api/card-groups"))["total"] == 0


async def test_import_a_group(client: AsyncClient, alice: AuthedUser, bob: AuthedUser) -> None:
    swamp = await create_origin(client, alice, name="Swamp")
    volcano = await create_origin(client, alice, name="Lava", color="vermillion", icon="flame")
    group = await create_group(client, alice, "Mix")
    for name, origin_id in [("Toad", swamp["id"]), ("Eel", swamp["id"]), ("Imp", volcano["id"])]:
        await create_card(client, alice, name=name, origin_id=origin_id, group_id=group["id"])
    await create_card(client, alice, name="Wolf", group_id=group["id"])
    code = await share(client, alice, f"/api/card-groups/{group['id']}")

    result = await import_code(client, bob, code)

    assert result["kind"] == "card_group"
    imported = result["group"]
    assert imported == await get(client, bob, f"/api/card-groups/{imported['id']}")
    assert (imported["name"], imported["card_count"], imported["share_code"]) == ("Mix", 4, None)
    origins = {origin["name"]: origin["id"] for origin in await custom_origins(client, bob)}
    assert sorted(origins) == ["Lava", "Swamp"]
    cards = (await get(client, bob, f"/api/cards?group_id={imported['id']}"))["items"]
    neutral_id = await system_origin_id(client, bob)
    assert {card["name"]: card["origin_id"] for card in cards} == {
        "Toad": origins["Swamp"],
        "Eel": origins["Swamp"],
        "Imp": origins["Lava"],
        "Wolf": neutral_id,
    }


async def test_imported_group_names_get_a_number(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    long_name = "x" * 40
    group = await create_group(client, alice, long_name)
    await create_group(client, bob, long_name.upper())
    code = await share(client, alice, f"/api/card-groups/{group['id']}")

    first = (await import_code(client, bob, code))["group"]
    second = (await import_code(client, bob, code))["group"]

    assert first["name"] == "x" * 36 + " (2)"
    assert second["name"] == "x" * 36 + " (3)"


async def test_importing_your_own_code_duplicates(
    client: AsyncClient, alice: AuthedUser, fake_s3: FakeS3
) -> None:
    swamp, deck = await swamp_deck(client, alice, fake_s3)
    code = await share(client, alice, f"/api/decks/{deck['id']}")

    copy = (await import_code(client, alice, code))["deck"]

    assert copy["id"] != deck["id"]
    assert copy["name"] == "Bog"
    assert len(await custom_origins(client, alice)) == 2
    assert copy["origin_id"] != swamp["id"]
    groups = (await get(client, alice, "/api/card-groups"))["items"]
    assert [group["name"] for group in groups] == ["Bog"]


async def test_the_copy_is_independent_of_the_original(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser, fake_s3: FakeS3
) -> None:
    swamp, source = await swamp_deck(client, alice, fake_s3)
    code = await share(client, alice, f"/api/decks/{source['id']}")
    copy = (await import_code(client, bob, code))["deck"]
    toad = next(entry["card"] for entry in copy["cards"] if entry["card"]["name"] == "Toad")

    # Bob edits his copy. The art key stays the author's and isn't checked again (no HEAD:
    # the object is gone from the fake bucket).
    fake_s3.objects.clear()
    patched = await client.patch(
        f"/api/cards/{toad['id']}", json={"name": "Frog"}, headers=bob.headers
    )
    # Alice changes and then deletes everything she owns, origin included.
    original_toad = next(e["card"] for e in source["cards"] if e["card"]["name"] == "Toad")
    renamed = await client.patch(
        f"/api/cards/{original_toad['id']}", json={"name": "Newt"}, headers=alice.headers
    )
    await client.delete(f"/api/decks/{source['id']}", headers=alice.headers)
    for entry in source["cards"]:
        await client.delete(f"/api/cards/{entry['card']['id']}", headers=alice.headers)
    deleted_origin = await client.delete(f"/api/origins/{swamp['id']}", headers=alice.headers)

    assert patched.status_code == 200, patched.text
    assert patched.json()["art_key"] == toad["art_key"]
    assert renamed.json()["name"] == "Newt"
    assert deleted_origin.status_code == 204
    after = await get(client, bob, f"/api/decks/{copy['id']}")
    assert [entry["card"]["name"] for entry in after["cards"]] == ["Eel", "Wolf", "Frog"]
    assert after["origin_id"] == copy["origin_id"]
    assert (await custom_origins(client, bob))[0]["name"] == "Swamp"
