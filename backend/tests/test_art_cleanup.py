import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, cast
from uuid import uuid4

import pytest
from httpx import AsyncClient
from redis.asyncio import Redis
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import User
from app.services import art_cleanup_service
from app.services.art_cleanup_service import LAST_RUN_KEY, SessionFactory, SweepResult
from tests.helpers import (
    UPLOADED_AT,
    AuthedUser,
    FakeS3,
    create_card,
    create_group,
    create_origin,
    logged,
    share,
    uploaded_art,
)

# The sweep runs two days after the fake uploads, so with the 24 h grace they are all old.
SWEEP_AT = UPLOADED_AT + timedelta(days=2)
OLDER_THAN = SWEEP_AT - timedelta(hours=24)


async def sweep(db: AsyncSession, fake_s3: FakeS3, **options: Any) -> SweepResult:
    return await art_cleanup_service.sweep(
        db,
        fake_s3,
        "test-bucket",
        older_than=OLDER_THAN,
        max_deletes=options.pop("max_deletes", 200),
        **options,
    )


def orphans(fake_s3: FakeS3, user: AuthedUser, count: int) -> list[str]:
    """Art keys that were uploaded but never saved on a card."""
    return [uploaded_art(fake_s3, "card-art", user) for _ in range(count)]


@dataclass
class FakeRedis:
    """The one Redis command the sweep's gate uses."""

    values: dict[str, str] = field(default_factory=dict)
    expiries: dict[str, int] = field(default_factory=dict)

    async def set(
        self, name: str, value: str, *, nx: bool = False, ex: int | None = None
    ) -> bool | None:
        if nx and name in self.values:
            return None
        self.values[name] = value
        if ex is not None:
            self.expiries[name] = ex
        return True


def session_factory(db: AsyncSession) -> SessionFactory:
    """Hands out the test's session, without closing it as a real factory's session would be."""

    @asynccontextmanager
    async def open_session() -> AsyncIterator[AsyncSession]:
        yield db

    return open_session


async def test_deletes_an_abandoned_upload_and_keeps_a_young_one(
    db: AsyncSession, fake_s3: FakeS3, alice: AuthedUser
) -> None:
    (abandoned,) = orphans(fake_s3, alice, 1)
    young = f"card-art/{alice.id}/{uuid4()}.png"
    fake_s3.put(young, 1000, "image/png", last_modified=OLDER_THAN + timedelta(minutes=1))

    result = await sweep(db, fake_s3)

    assert abandoned not in fake_s3.objects
    assert young in fake_s3.objects
    assert (result.listed, result.too_new, result.candidates, result.deleted) == (2, 1, 1, 1)


async def test_keeps_card_art_and_origin_backgrounds_in_use(
    client: AsyncClient, db: AsyncSession, fake_s3: FakeS3, alice: AuthedUser
) -> None:
    background = uploaded_art(fake_s3, "origin-art", alice)
    swamp = await create_origin(client, alice, background_art_key=background)
    art = uploaded_art(fake_s3, "card-art", alice)
    await create_card(client, alice, origin_id=swamp["id"], art_key=art)

    result = await sweep(db, fake_s3)

    assert {background, art} <= fake_s3.objects.keys()
    assert (result.listed, result.referenced, result.deleted) == (2, 2, 0)


async def test_deletes_replaced_and_cleared_art(
    client: AsyncClient, db: AsyncSession, fake_s3: FakeS3, alice: AuthedUser
) -> None:
    first, second, cleared = orphans(fake_s3, alice, 3)
    wolf = await create_card(client, alice, art_key=first)
    toad = await create_card(client, alice, name="Toad", art_key=cleared)
    replaced = await client.patch(
        f"/api/cards/{wolf['id']}", json={"art_key": second}, headers=alice.headers
    )
    emptied = await client.patch(
        f"/api/cards/{toad['id']}", json={"art_key": None}, headers=alice.headers
    )
    assert (replaced.status_code, emptied.status_code) == (200, 200)

    await sweep(db, fake_s3)

    assert second in fake_s3.objects
    assert first not in fake_s3.objects
    assert cleared not in fake_s3.objects


async def test_deletes_the_art_of_a_deleted_card_and_origin(
    client: AsyncClient, db: AsyncSession, fake_s3: FakeS3, alice: AuthedUser
) -> None:
    background = uploaded_art(fake_s3, "origin-art", alice)
    swamp = await create_origin(client, alice, background_art_key=background)
    art = uploaded_art(fake_s3, "card-art", alice)
    toad = await create_card(client, alice, origin_id=swamp["id"], art_key=art)
    card_gone = await client.delete(f"/api/cards/{toad['id']}", headers=alice.headers)
    origin_gone = await client.delete(f"/api/origins/{swamp['id']}", headers=alice.headers)
    assert (card_gone.status_code, origin_gone.status_code) == (204, 204)

    result = await sweep(db, fake_s3)

    assert fake_s3.objects == {}
    assert result.deleted == 2


async def _bobs_copy_of_alices_card(
    client: AsyncClient, fake_s3: FakeS3, alice: AuthedUser, bob: AuthedUser
) -> tuple[dict[str, Any], dict[str, Any], str]:
    """Alice's card with art, shared in a group and imported by Bob: (hers, his copy, the key)."""
    art = uploaded_art(fake_s3, "card-art", alice)
    group = await create_group(client, alice, "Swamp things")
    toad = await create_card(client, alice, name="Toad", group_id=group["id"], art_key=art)
    code = await share(client, alice, f"/api/card-groups/{group['id']}")
    imported = await client.post(f"/api/share/{code}/import", headers=bob.headers)
    assert imported.status_code == 201, imported.text
    bobs_cards = await client.get("/api/cards", headers=bob.headers)
    (copy,) = bobs_cards.json()["items"]
    assert copy["art_key"] == art
    return toad, copy, art


async def test_an_imported_copy_keeps_the_authors_art(
    client: AsyncClient, db: AsyncSession, fake_s3: FakeS3, alice: AuthedUser, bob: AuthedUser
) -> None:
    toad, copy, art = await _bobs_copy_of_alices_card(client, fake_s3, alice, bob)
    await client.delete(f"/api/cards/{toad['id']}", headers=alice.headers)

    await sweep(db, fake_s3)
    assert art in fake_s3.objects

    await client.delete(f"/api/cards/{copy['id']}", headers=bob.headers)
    await sweep(db, fake_s3)
    assert art not in fake_s3.objects


async def _delete_user(db: AsyncSession, user: AuthedUser) -> None:
    """A plain DELETE on users, as in test_user_deletion.py."""
    await db.execute(delete(User).where(User.id == user.id))
    await db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))


async def test_a_deleted_accounts_art_is_deleted_unless_an_import_uses_it(
    client: AsyncClient, db: AsyncSession, fake_s3: FakeS3, alice: AuthedUser, bob: AuthedUser
) -> None:
    _, _, imported_art = await _bobs_copy_of_alices_card(client, fake_s3, alice, bob)
    own_art = uploaded_art(fake_s3, "card-art", alice)
    await create_card(client, alice, name="Eel", art_key=own_art)

    await _delete_user(db, alice)
    await sweep(db, fake_s3)

    assert imported_art in fake_s3.objects
    assert own_art not in fake_s3.objects


async def test_ignores_keys_without_the_art_key_shape(
    db: AsyncSession, fake_s3: FakeS3, alice: AuthedUser
) -> None:
    others = [
        "card-art/readme.txt",
        f"card-art/{alice.id}/{uuid4()}.gif",
        f"card-art/{alice.id}/nested/{uuid4()}.png",
        f"backups/{alice.id}/{uuid4()}.png",
        f"origin-art/{alice.id}/{uuid4()}.PNG",
    ]
    for key in others:
        fake_s3.put(key, 1000, "image/png")

    result = await sweep(db, fake_s3)

    assert set(others) <= fake_s3.objects.keys()
    assert result.listed == 0


async def test_a_dry_run_deletes_nothing(
    db: AsyncSession, fake_s3: FakeS3, alice: AuthedUser, logs: list[dict[str, Any]]
) -> None:
    (abandoned,) = orphans(fake_s3, alice, 1)

    result = await sweep(db, fake_s3, dry_run=True)

    assert abandoned in fake_s3.objects
    assert (result.candidates, result.deleted, result.dry_run) == (1, 0, True)
    assert [line["art_key"] for line in logged(logs, "art.would_delete")] == [abandoned]
    assert logged(logs, "art.deleted") == []


async def test_aborts_above_max_deletes(
    db: AsyncSession, fake_s3: FakeS3, alice: AuthedUser, logs: list[dict[str, Any]]
) -> None:
    keys = orphans(fake_s3, alice, 3)

    result = await sweep(db, fake_s3, max_deletes=2)

    assert set(keys) <= fake_s3.objects.keys()
    assert (result.aborted, result.candidates, result.deleted) == (True, 3, 0)
    (line,) = logged(logs, "art.sweep_aborted")
    assert (line["log_level"], line["candidates"], line["max_deletes"]) == ("warning", 3, 2)
    assert logged(logs, "art.swept") == []


async def test_a_failed_delete_is_logged_and_the_rest_still_go(
    db: AsyncSession, fake_s3: FakeS3, alice: AuthedUser, logs: list[dict[str, Any]]
) -> None:
    failing, other = orphans(fake_s3, alice, 2)
    fake_s3.failing_deletes.add(failing)

    result = await sweep(db, fake_s3)

    assert failing in fake_s3.objects
    assert other not in fake_s3.objects
    assert (result.deleted, result.failed) == (1, 1)
    (line,) = logged(logs, "art.delete_failed")
    assert (line["log_level"], line["art_key"], line["exc_info"]) == ("warning", failing, True)


async def test_lists_across_pages(db: AsyncSession, fake_s3: FakeS3, alice: AuthedUser) -> None:
    fake_s3.page_size = 2
    orphans(fake_s3, alice, 5)

    result = await sweep(db, fake_s3)

    assert (result.listed, result.deleted) == (5, 5)
    assert fake_s3.objects == {}


async def test_the_swept_line(
    client: AsyncClient,
    db: AsyncSession,
    fake_s3: FakeS3,
    alice: AuthedUser,
    logs: list[dict[str, Any]],
) -> None:
    (abandoned,) = orphans(fake_s3, alice, 1)
    await create_card(client, alice, art_key=uploaded_art(fake_s3, "card-art", alice))
    fake_s3.put(f"card-art/{alice.id}/{uuid4()}.png", 1000, "image/png", last_modified=SWEEP_AT)

    await sweep(db, fake_s3)

    (deleted,) = logged(logs, "art.deleted")
    assert deleted["art_key"] == abandoned
    (line,) = logged(logs, "art.swept")
    counts = {name: line[name] for name in ("listed", "too_new", "referenced", "candidates")}
    assert counts == {"listed": 3, "too_new": 1, "referenced": 1, "candidates": 1}
    assert (line["deleted"], line["failed"], line["dry_run"]) == (1, 0, False)
    assert line["log_level"] == "info"
    assert isinstance(line["duration_ms"], int)


async def test_run_if_due_sweeps_once_per_interval(
    db: AsyncSession,
    fake_s3: FakeS3,
    settings: Settings,
    alice: AuthedUser,
    logs: list[dict[str, Any]],
) -> None:
    redis = FakeRedis()
    (abandoned,) = orphans(fake_s3, alice, 1)

    first = await art_cleanup_service.run_if_due(
        session_factory(db), cast(Redis, redis), fake_s3, settings, now=SWEEP_AT
    )
    again = await art_cleanup_service.run_if_due(
        session_factory(db), cast(Redis, redis), fake_s3, settings, now=SWEEP_AT
    )

    assert first is not None and first.deleted == 1
    assert abandoned not in fake_s3.objects
    assert again is None
    assert redis.expiries[LAST_RUN_KEY] == settings.art_sweep_interval_h * 3600
    assert len(logged(logs, "art.sweep_skipped")) == 1


async def test_run_if_due_keeps_uploads_within_the_grace_period(
    db: AsyncSession, fake_s3: FakeS3, settings: Settings, alice: AuthedUser
) -> None:
    (recent,) = orphans(fake_s3, alice, 1)
    now = UPLOADED_AT + timedelta(hours=settings.art_sweep_grace_h) - timedelta(minutes=1)

    result = await art_cleanup_service.run_if_due(
        session_factory(db), cast(Redis, FakeRedis()), fake_s3, settings, now=now
    )

    assert result is not None and result.too_new == 1
    assert recent in fake_s3.objects


async def test_the_loop_logs_a_failure_and_goes_on(
    monkeypatch: pytest.MonkeyPatch,
    db: AsyncSession,
    fake_s3: FakeS3,
    settings: Settings,
    logs: list[dict[str, Any]],
) -> None:
    calls = 0

    async def failing_run(*_args: Any, **_kwargs: Any) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("R2 is down")
        # Stands in for the app stopping, which cancels the task.
        raise asyncio.CancelledError

    monkeypatch.setattr(art_cleanup_service, "run_if_due", failing_run)
    monkeypatch.setattr(art_cleanup_service, "_FIRST_CHECK_DELAY_S", 0)
    monkeypatch.setattr(art_cleanup_service, "_CHECK_EVERY_S", 0)

    with pytest.raises(asyncio.CancelledError):
        await art_cleanup_service.sweep_forever(
            session_factory(db), cast(Redis, FakeRedis()), fake_s3, settings
        )

    assert calls == 2
    (line,) = logged(logs, "art.sweep_failed")
    assert (line["log_level"], line["exc_info"]) == ("error", True)
