import re
from typing import Any

import pytest
from httpx import AsyncClient

from tests.helpers import (
    PUBLIC_BASE_URL,
    AuthedUser,
    FakeS3,
    assert_error,
    create_card,
    create_origin,
)

MAX_BYTES = 2 * 1024 * 1024
UUID_RE = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"


async def _ticket(
    client: AsyncClient, user: AuthedUser, kind: str = "card-art", **body: Any
) -> dict[str, Any]:
    payload = {"content_type": "image/png", "size": 1000} | body
    response = await client.post(f"/api/uploads/{kind}", json=payload, headers=user.headers)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


async def _uploaded_key(
    client: AsyncClient,
    user: AuthedUser,
    fake_s3: FakeS3,
    kind: str = "card-art",
    content_type: str = "image/png",
) -> str:
    """Request a ticket, then pretend the browser PUT the file."""
    key: str = (await _ticket(client, user, kind, content_type=content_type))["art_key"]
    fake_s3.put(key, size=1000, content_type=content_type)
    return key


# --- presigned URLs ---


@pytest.mark.parametrize(
    ("kind", "content_type", "extension"),
    [
        ("card-art", "image/png", "png"),
        ("card-art", "image/jpeg", "jpg"),
        ("origin-art", "image/webp", "webp"),
    ],
)
async def test_upload_ticket(
    client: AsyncClient,
    alice: AuthedUser,
    fake_s3: FakeS3,
    kind: str,
    content_type: str,
    extension: str,
) -> None:
    ticket = await _ticket(client, alice, kind, content_type=content_type, size=MAX_BYTES)

    assert re.fullmatch(rf"{kind}/{alice.id}/{UUID_RE}\.{extension}", ticket["art_key"])
    assert ticket["expires_in"] == 300
    assert ticket["upload_url"].startswith("https://upload.test/")
    assert fake_s3.presigned == [
        {
            "method": "put_object",
            "params": {
                "Bucket": "test-bucket",
                "Key": ticket["art_key"],
                "ContentType": content_type,
            },
            "expires_in": 300,
        }
    ]


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"content_type": "image/gif", "size": 1000}, "unsupported_art_type"),
        ({"content_type": "text/html", "size": 1000}, "unsupported_art_type"),
        ({"content_type": "image/png", "size": MAX_BYTES + 1}, "art_too_large"),
    ],
)
async def test_bad_upload_is_rejected_before_signing(
    client: AsyncClient, alice: AuthedUser, fake_s3: FakeS3, body: dict[str, Any], code: str
) -> None:
    response = await client.post("/api/uploads/card-art", json=body, headers=alice.headers)

    assert_error(response, 422, code)
    assert fake_s3.presigned == []


async def test_upload_size_must_be_positive(client: AsyncClient, alice: AuthedUser) -> None:
    body = {"content_type": "image/png", "size": 0}

    response = await client.post("/api/uploads/card-art", json=body, headers=alice.headers)

    assert response.status_code == 422


async def test_uploads_need_login(client: AsyncClient) -> None:
    body = {"content_type": "image/png", "size": 1000}

    response = await client.post("/api/uploads/card-art", json=body)

    assert_error(response, 401, "not_authenticated")


# --- art keys on cards ---


async def test_card_with_uploaded_art(
    client: AsyncClient, alice: AuthedUser, fake_s3: FakeS3
) -> None:
    key = await _uploaded_key(client, alice, fake_s3)

    card = await create_card(client, alice, art_key=key)

    assert card["art_key"] == key
    assert card["art_url"] == f"{PUBLIC_BASE_URL}/{key}"


async def test_unchanged_art_key_is_not_checked_again(
    client: AsyncClient, alice: AuthedUser, fake_s3: FakeS3
) -> None:
    key = await _uploaded_key(client, alice, fake_s3)
    card = await create_card(client, alice, art_key=key)
    fake_s3.objects.clear()
    url = f"/api/cards/{card['id']}"

    renamed = await client.patch(url, json={"name": "Renamed"}, headers=alice.headers)
    cleared = await client.patch(url, json={"art_key": None}, headers=alice.headers)

    assert renamed.status_code == 200
    assert renamed.json()["art_url"] == card["art_url"]
    assert cleared.json()["art_key"] is None
    assert cleared.json()["art_url"] is None


async def test_card_art_must_exist(client: AsyncClient, alice: AuthedUser) -> None:
    key = (await _ticket(client, alice))["art_key"]  # signed but never uploaded

    response = await client.post(
        "/api/cards",
        json=await _creature_body(client, alice) | {"art_key": key},
        headers=alice.headers,
    )

    assert_error(response, 422, "invalid_art_key")


@pytest.mark.parametrize(
    ("size", "content_type"), [(MAX_BYTES + 1, "image/png"), (1000, "image/svg+xml")]
)
async def test_stored_art_is_checked(
    client: AsyncClient, alice: AuthedUser, fake_s3: FakeS3, size: int, content_type: str
) -> None:
    # A presigned PUT can't cap the size, so the stored object is checked on save.
    key = (await _ticket(client, alice))["art_key"]
    fake_s3.put(key, size=size, content_type=content_type)

    response = await client.post(
        "/api/cards",
        json=await _creature_body(client, alice) | {"art_key": key},
        headers=alice.headers,
    )

    assert_error(response, 422, "invalid_art_key")


async def test_art_keys_belong_to_their_uploader_and_use(
    client: AsyncClient, alice: AuthedUser, bob: AuthedUser, fake_s3: FakeS3
) -> None:
    bobs_key = await _uploaded_key(client, bob, fake_s3)
    origin_key = await _uploaded_key(client, alice, fake_s3, kind="origin-art")
    body = await _creature_body(client, alice)

    for key in (bobs_key, origin_key, "card-art/../secret.png"):
        response = await client.post(
            "/api/cards", json=body | {"art_key": key}, headers=alice.headers
        )
        assert_error(response, 422, "invalid_art_key")


# --- background art on origins ---


async def test_origin_with_background_art(
    client: AsyncClient, alice: AuthedUser, fake_s3: FakeS3
) -> None:
    key = await _uploaded_key(client, alice, fake_s3, kind="origin-art", content_type="image/webp")

    origin = await create_origin(client, alice, background_art_key=key)

    assert origin["background_art_key"] == key
    assert origin["background_art_url"] == f"{PUBLIC_BASE_URL}/{key}"


async def test_origin_art_is_checked(
    client: AsyncClient, alice: AuthedUser, fake_s3: FakeS3
) -> None:
    card_key = await _uploaded_key(client, alice, fake_s3)
    origin = await create_origin(client, alice)

    response = await client.patch(
        f"/api/origins/{origin['id']}",
        json={"background_art_key": card_key},
        headers=alice.headers,
    )

    assert_error(response, 422, "invalid_art_key")


async def _creature_body(client: AsyncClient, user: AuthedUser) -> dict[str, Any]:
    origins = (await client.get("/api/origins", headers=user.headers)).json()["items"]
    neutral = next(origin for origin in origins if origin["system_key"] == "neutral")
    return {
        "kind": "creature",
        "name": "Wolf",
        "origin_id": neutral["id"],
        "mana_cost": 2,
        "hp": 2,
        "dmg": 2,
    }
