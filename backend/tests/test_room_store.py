"""A room in Redis: one hash per room, written with a compare-and-set on `rev`."""

from typing import Any
from uuid import uuid4

import pytest
from redis.asyncio import Redis

from app.core.config import Settings
from app.schemas.rules import RulesetDefinition
from app.services.room_store import (
    Room,
    RoomExists,
    RoomMember,
    RoomStore,
    StaleRoom,
    StoredRuleset,
)
from tests.engine.builders import new_game
from tests.helpers import logged


@pytest.fixture
def store(redis: Redis, settings: Settings) -> RoomStore:
    return RoomStore(redis, settings)


def _room(code: str = "ABCDEF") -> Room:
    ruleset = StoredRuleset(id=uuid4(), name="Default", definition=RulesetDefinition())
    return Room(code=code, ruleset=ruleset, host=RoomMember(user_id=uuid4(), username="alice"))


async def test_a_new_room_is_stored_for_24_hours(store: RoomStore, redis: Redis) -> None:
    created = await store.create(_room())

    assert created.rev == 1
    assert await store.load("ABCDEF") == created
    assert sorted(await redis.hkeys("room:ABCDEF")) == ["data", "rev"]
    assert 24 * 3600 - 60 < await redis.ttl("room:ABCDEF") <= 24 * 3600


async def test_a_taken_code_is_refused(store: RoomStore) -> None:
    await store.create(_room())

    with pytest.raises(RoomExists):
        await store.create(_room())


async def test_a_write_moves_the_rev_on(store: RoomStore) -> None:
    created = await store.create(_room())
    guest = RoomMember(user_id=uuid4(), username="bob")

    saved = await store.save(created.model_copy(update={"guest": guest}))

    assert saved.rev == 2
    assert await store.load("ABCDEF") == saved


async def test_a_write_from_an_old_rev_loses(store: RoomStore, logs: list[dict[str, Any]]) -> None:
    created = await store.create(_room())
    await store.save(created)

    with pytest.raises(StaleRoom) as exc_info:
        await store.save(created)

    assert exc_info.value.missing is False
    loaded = await store.load("ABCDEF")
    assert loaded is not None and loaded.rev == 2
    (line,) = logged(logs, "room.store_conflict")
    assert (line["log_level"], line["room_code"], line["missing"]) == ("warning", "ABCDEF", False)


async def test_a_write_to_a_room_that_is_gone_loses(store: RoomStore, redis: Redis) -> None:
    created = await store.create(_room())
    await redis.delete("room:ABCDEF")

    with pytest.raises(StaleRoom) as exc_info:
        await store.save(created)

    assert exc_info.value.missing is True
    assert await store.load("ABCDEF") is None


async def test_a_finished_room_is_kept_10_minutes(store: RoomStore, redis: Redis) -> None:
    created = await store.create(_room())

    await store.save(created.model_copy(update={"status": "finished"}))

    assert 0 < await redis.ttl("room:ABCDEF") <= 600


async def test_delete_compares_the_rev_too(store: RoomStore) -> None:
    created = await store.create(_room())
    saved = await store.save(created)

    with pytest.raises(StaleRoom):
        await store.delete(created)
    await store.delete(saved)

    assert await store.load("ABCDEF") is None


async def test_a_game_state_survives_the_round_trip(store: RoomStore) -> None:
    state = new_game()
    created = await store.create(_room().model_copy(update={"status": "playing", "state": state}))

    loaded = await store.load("ABCDEF")

    assert loaded is not None and loaded.state is not None
    assert loaded.state.model_dump() == state.model_dump()
    assert loaded == created
