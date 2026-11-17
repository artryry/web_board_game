"""Helpers for the room and game-socket tests: a clock the tests move, a socket wrapper, and
players with decks in a room."""

import asyncio
import random
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI
from httpx import AsyncClient
from httpx_ws import AsyncWebSocketSession, WebSocketDisconnect, aconnect_ws
from redis.asyncio import Redis

from app.core.config import Settings
from app.services import room_service
from app.services.live_rooms import LiveRooms
from app.ws.manager import ConnectionManager
from tests.helpers import AuthedUser, create_card, create_deck, create_ruleset

# A wait that only a broken test reaches (nothing here sleeps on purpose).
RECEIVE_TIMEOUT_S = 5.0
# httpx-ws refuses bigger messages; a game state can pass its 64 KiB default.
MAX_MESSAGE_BYTES = 4 * 1024 * 1024


class FakeClock:
    """Time that moves only when a test calls `advance`. `sleep_until` waits for it."""

    def __init__(self, now_ms: int = 1_800_000_000_000) -> None:
        self._now = now_ms
        self._sleepers: list[tuple[int, asyncio.Future[None]]] = []

    def now_ms(self) -> int:
        return self._now

    async def sleep_until(self, when_ms: int) -> None:
        if when_ms <= self._now:
            return
        entry = (when_ms, asyncio.get_running_loop().create_future())
        self._sleepers.append(entry)
        try:
            await entry[1]
        finally:
            if entry in self._sleepers:
                self._sleepers.remove(entry)

    def advance(self, seconds: float) -> None:
        """Moves time forward and wakes every sleeper whose time has come."""
        self._now += round(seconds * 1000)
        for when_ms, future in list(self._sleepers):
            if when_ms <= self._now and not future.done():
                future.set_result(None)

    async def wait_for_sleepers(self, count: int = 1) -> None:
        """Yields to the event loop until `count` tasks wait on the clock."""
        for _ in range(10_000):
            if sum(not future.done() for _, future in self._sleepers) >= count:
                return
            await asyncio.sleep(0)
        raise AssertionError(f"Fewer than {count} tasks are waiting on the clock")


@dataclass
class Socket:
    """A game socket as a client sees it."""

    ws: AsyncWebSocketSession
    seq: int = 0

    async def send(self, message_type: str, payload: dict[str, Any] | None = None) -> int:
        self.seq += 1
        await self.ws.send_json({"type": message_type, "seq": self.seq, "payload": payload or {}})
        return self.seq

    async def action(self, action: dict[str, Any]) -> int:
        return await self.send("action", action)

    async def receive(self) -> dict[str, Any]:
        message: dict[str, Any] = await self.ws.receive_json(timeout=RECEIVE_TIMEOUT_S)
        return message

    async def expect(self, message_type: str) -> dict[str, Any]:
        """The next message, which must be of this type; returns its payload."""
        message = await self.receive()
        assert message["type"] == message_type, message
        payload: dict[str, Any] = message["payload"]
        return payload

    async def until(self, message_type: str) -> dict[str, Any]:
        """Skips messages up to the next one of this type; returns its payload."""
        while True:
            message = await self.receive()
            if message["type"] == message_type:
                payload: dict[str, Any] = message["payload"]
                return payload

    async def close_code(self) -> int:
        """Reads until the server closes the socket; returns the close code."""
        while True:
            try:
                await self.ws.receive(timeout=RECEIVE_TIMEOUT_S)
            except WebSocketDisconnect as exc:
                return exc.code

    async def nothing_pending(self) -> bool:
        """Whether no message is waiting (after a ping round trip, so everything sent before it
        has arrived)."""
        await self.send("ping")
        message = await self.receive()
        return bool(message["type"] == "pong")


async def eventually(condition: Callable[[], object]) -> None:
    """Yields to the event loop until `condition()` is true, for what the server does after a
    socket closes on the client's side (no message tells the test when it's done)."""
    for _ in range(10_000):
        if condition():
            return
        await asyncio.sleep(0)
    raise AssertionError("The condition never became true")


def token_of(user: AuthedUser) -> str:
    return user.headers["Authorization"].removeprefix("Bearer ")


@asynccontextmanager
async def open_socket(
    client: AsyncClient, code: str, user: AuthedUser | None = None
) -> AsyncIterator[Socket]:
    """A socket to the room; with `user`, it sends their `auth` first."""
    async with aconnect_ws(
        f"http://test/ws/rooms/{code}",
        client,
        max_message_size_bytes=MAX_MESSAGE_BYTES,
        session_class=AsyncWebSocketSession,
    ) as ws:
        socket = Socket(ws)
        if user is not None:
            await socket.send("auth", {"token": token_of(user)})
        yield socket


async def joined_socket(stack: Any, client: AsyncClient, code: str, user: AuthedUser) -> Socket:
    """Opens `user`'s socket in an AsyncExitStack and reads the first `room_state`."""
    socket: Socket = await stack.enter_async_context(open_socket(client, code, user))
    await socket.expect("room_state")
    return socket


@asynccontextmanager
async def restarted(
    app: FastAPI, old: LiveRooms, redis: Redis, settings: Settings, clock: FakeClock
) -> AsyncIterator[LiveRooms]:
    """The app as after a restart: the old process's rooms (locks, sockets, timers) are gone,
    and new ones load the rooms from Redis on their first use."""
    await old.aclose()
    connections = ConnectionManager()
    rooms = room_service.create_room_runtime(redis, settings, clock, connections, random.Random(1))
    app.state.rooms = rooms
    app.state.connections = connections
    try:
        yield rooms
    finally:
        await rooms.aclose()


# --- Content ---


async def small_ruleset(client: AsyncClient, user: AuthedUser, **sections: Any) -> str:
    """Decks of exactly 10 cards and a quick board (one lane, sections of 4 HP), unless
    `sections` say otherwise."""
    definition = {
        "deck": {"size": 10, "max_copies": 2},
        "board": {"lanes": 1, "section_hp": 4},
    } | sections
    ruleset = await create_ruleset(client, user, **definition)
    ruleset_id: str = ruleset["id"]
    return ruleset_id


async def playable_deck(
    client: AsyncClient, user: AuthedUser, name: str = "Pack", hp: int = 2, dmg: int = 2
) -> str:
    """Ten neutral creatures (2/2 unless said otherwise) for 1 mana: five cards, two copies
    each."""
    cards = [
        await create_card(client, user, name=f"{name} {n}", mana_cost=1, hp=hp, dmg=dmg)
        for n in range(5)
    ]
    deck = await create_deck(client, user, [(card, 2) for card in cards], name=name)
    deck_id: str = deck["id"]
    return deck_id


async def create_room(client: AsyncClient, user: AuthedUser, ruleset_id: str) -> str:
    response = await client.post(
        "/api/rooms", json={"ruleset_id": ruleset_id}, headers=user.headers
    )
    assert response.status_code == 201, response.text
    code: str = response.json()["code"]
    return code


async def join_room(client: AsyncClient, user: AuthedUser, code: str) -> dict[str, Any]:
    response = await client.post("/api/rooms/join", json={"code": code}, headers=user.headers)
    assert response.status_code == 200, response.text
    state: dict[str, Any] = response.json()
    return state


@dataclass
class Table:
    """Two players in one room, each with a playable deck."""

    code: str
    host_deck: str
    guest_deck: str


async def table(
    client: AsyncClient,
    host: AuthedUser,
    guest: AuthedUser,
    strong_host: bool = False,
    **sections: Any,
) -> Table:
    """With `strong_host`, the host's creatures are 3/3 against the guest's 1/1, so a game
    between bots ends with the host conquering, not with both running out of cards."""
    ruleset_id = await small_ruleset(client, host, **sections)
    code = await create_room(client, host, ruleset_id)
    await join_room(client, guest, code)
    host_stats, guest_stats = ((3, 3), (1, 1)) if strong_host else ((2, 2), (2, 2))
    return Table(
        code=code,
        host_deck=await playable_deck(client, host, "Wolves", *host_stats),
        guest_deck=await playable_deck(client, guest, "Bears", *guest_stats),
    )


async def start_game(host_socket: Socket, guest_socket: Socket, tbl: Table) -> None:
    """Both players pick their decks and get ready; reads up to each one's first game_state."""
    await host_socket.send("select_deck", {"deck_id": tbl.host_deck})
    await guest_socket.send("select_deck", {"deck_id": tbl.guest_deck})
    await host_socket.send("ready", {"ready": True})
    await guest_socket.send("ready", {"ready": True})
    await host_socket.until("game_state")
    await guest_socket.until("game_state")
