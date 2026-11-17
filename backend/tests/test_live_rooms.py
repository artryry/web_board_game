"""The in-process side of rooms: one lock and one load per room, the cache, and lost writes."""

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from uuid import uuid4

import pytest
from pydantic import BaseModel
from redis.asyncio import Redis

from app.core.config import Settings
from app.schemas.room import CloseCode, ServerMessageType
from app.schemas.rules import RulesetDefinition
from app.services import room_service
from app.services.live_rooms import LiveRoom, LiveRooms, RoomError
from app.services.room_store import Room, RoomMember, RoomStore, StoredRuleset
from tests.room_helpers import FakeClock


@dataclass
class FakeNotifier:
    sent: list[tuple[str, ServerMessageType]] = field(default_factory=list)
    closed: list[tuple[str, int]] = field(default_factory=list)

    def send(
        self, conn_id: str, message_type: ServerMessageType, payload: BaseModel | None = None
    ) -> None:
        self.sent.append((conn_id, message_type))

    def close(self, conn_id: str, close_code: int) -> None:
        self.closed.append((conn_id, close_code))


@pytest.fixture
def notifier() -> FakeNotifier:
    return FakeNotifier()


@pytest.fixture
async def live_rooms(
    redis: Redis, settings: Settings, clock: FakeClock, notifier: FakeNotifier
) -> AsyncIterator[LiveRooms]:
    rooms = room_service.create_room_runtime(redis, settings, clock, notifier)
    yield rooms
    await rooms.aclose()


async def _created(rooms: LiveRooms) -> Room:
    ruleset = StoredRuleset(id=uuid4(), name="Default", definition=RulesetDefinition())
    host = RoomMember(user_id=uuid4(), username="alice")
    return await rooms.create(Room(code="ABCDEF", ruleset=ruleset, host=host))


async def test_concurrent_first_uses_share_one_lock_and_one_load(live_rooms: LiveRooms) -> None:
    await _created(live_rooms)
    loads = 0
    load = live_rooms.store.load

    async def counting_load(code: str) -> Room | None:
        nonlocal loads
        loads += 1
        return await load(code)

    live_rooms.store.load = counting_load  # type: ignore[method-assign]

    async def use() -> LiveRoom:
        async with live_rooms.use("ABCDEF") as live:
            await asyncio.sleep(0)
            return live

    first, second = await asyncio.gather(use(), use())

    assert first is second
    assert loads == 1


async def test_a_room_nothing_uses_leaves_memory_but_one_with_a_socket_stays(
    live_rooms: LiveRooms,
) -> None:
    created = await _created(live_rooms)

    async with live_rooms.use("ABCDEF") as live:
        assert live.room == created
    assert live_rooms.peek("ABCDEF") is None

    async with live_rooms.use("ABCDEF") as live:
        live.connections[created.host.user_id] = "conn-1"
    assert live_rooms.peek("ABCDEF") == created


async def test_a_lost_write_reloads_the_room_and_sends_it(
    live_rooms: LiveRooms, redis: Redis, settings: Settings, notifier: FakeNotifier
) -> None:
    created = await _created(live_rooms)
    # Another instance (during a deploy) writes the room first.
    other = await RoomStore(redis, settings).save(created)

    async with live_rooms.use("ABCDEF") as live:
        live.room = created  # this process still has the old copy
        live.connections[created.host.user_id] = "conn-1"
        with pytest.raises(RoomError) as exc_info:
            await live_rooms.save(live, created.model_copy(update={"status": "finished"}))

        assert exc_info.value.reason == "stale_state"
        assert live.room == other
    assert notifier.sent == [("conn-1", "room_state")]


async def test_a_room_gone_from_redis_closes_its_sockets(
    live_rooms: LiveRooms, redis: Redis, notifier: FakeNotifier
) -> None:
    created = await _created(live_rooms)

    async with live_rooms.use("ABCDEF") as live:
        live.connections[created.host.user_id] = "conn-1"
        await redis.delete("room:ABCDEF")
        with pytest.raises(RoomError):
            await live_rooms.save(live, created)

        assert live.room is None
    assert notifier.sent == [("conn-1", "room_closed")]
    assert notifier.closed == [("conn-1", CloseCode.NORMAL)]
