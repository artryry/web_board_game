from typing import Any

from httpx import AsyncClient
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Card, CardGroup, Deck, DeckCard, Origin, ShareCode, User
from tests.helpers import (
    AuthedUser,
    FakeS3,
    assert_error,
    create_card,
    create_deck,
    create_group,
    create_origin,
    share,
    uploaded_art,
)


async def delete_user(db: AsyncSession, user: AuthedUser) -> None:
    """One plain DELETE on users, as an admin or a future account endpoint would run it."""
    await db.execute(delete(User).where(User.id == user.id))
    # Deferred FK checks run at COMMIT, which the test transaction never reaches; run them now.
    await db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))


async def count(db: AsyncSession, model: Any, *where: Any) -> int:
    return await db.scalar(select(func.count()).select_from(model).where(*where)) or 0


async def alices_content(client: AsyncClient, alice: AuthedUser, fake_s3: FakeS3) -> str:
    """A custom origin, a group, cards in and out of a deck, and both kinds of share code.
    Returns the deck's share code."""
    swamp = await create_origin(client, alice)
    group = await create_group(client, alice, "Swamp things")
    toad = await create_card(
        client,
        alice,
        name="Toad",
        origin_id=swamp["id"],
        group_id=group["id"],
        art_key=uploaded_art(fake_s3, "card-art", alice),
    )
    await create_card(client, alice, name="Eel", origin_id=swamp["id"])  # in no deck
    wolf = await create_card(client, alice)
    deck = await create_deck(client, alice, [(toad, 2), (wolf, 1)], origin_id=swamp["id"])
    await share(client, alice, f"/api/card-groups/{group['id']}")
    return await share(client, alice, f"/api/decks/{deck['id']}")


async def test_deleting_a_user_deletes_their_content(
    client: AsyncClient, db: AsyncSession, alice: AuthedUser, fake_s3: FakeS3
) -> None:
    await alices_content(client, alice, fake_s3)

    await delete_user(db, alice)

    assert await count(db, Origin, Origin.owner_id == alice.id) == 0
    assert await count(db, CardGroup, CardGroup.owner_id == alice.id) == 0
    assert await count(db, Card, Card.owner_id == alice.id) == 0
    assert await count(db, Deck, Deck.owner_id == alice.id) == 0
    assert await count(db, DeckCard) == 0
    assert await count(db, ShareCode) == 0


async def test_imported_copies_outlive_the_author(
    client: AsyncClient, db: AsyncSession, alice: AuthedUser, bob: AuthedUser, fake_s3: FakeS3
) -> None:
    code = await alices_content(client, alice, fake_s3)
    imported = await client.post(f"/api/share/{code}/import", headers=bob.headers)
    copy = imported.json()["deck"]

    await delete_user(db, alice)

    after = await client.get(f"/api/decks/{copy['id']}", headers=bob.headers)
    preview = await client.get(f"/api/share/{code}", headers=bob.headers)
    assert after.status_code == 200, after.text
    # Unchanged, art included: the copies share the author's art key, and art is never deleted.
    assert after.json() == copy
    assert any(entry["card"]["art_url"] for entry in copy["cards"])
    assert_error(preview, 404, "share_not_found")
