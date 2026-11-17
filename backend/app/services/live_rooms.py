"""The in-process side of rooms (backend_plan §2, §9.3).

The app runs one worker, so each live room has an `asyncio.Lock` and a cached copy here, and its
timers are tasks in this process. Redis (`room_store`) stays the source of truth: a room is loaded
on its first use after a restart, and the cache changes only after a write to Redis succeeds.

This module also owns who is connected: each member's socket is a connection id, which the
`Notifier` (the WebSocket manager, `ws/manager.py`) maps to a socket. A service never imports
`ws/`; it sends through the notifier.

Rules that keep this safe:
- Everything that reads and then writes a room does so in one `use()`, under the room's lock.
- Nothing awaits the database while holding a room's lock, so a slow query never stalls a game.
- After every `use()`, the `settle` hook (`game_service.settle`) brings the room's away flags and
  tasks in line with its state, so no code path has to remember to re-arm a timer.
"""

import asyncio
import random
from collections.abc import AsyncGenerator, Awaitable, Callable, Collection
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Protocol
from uuid import UUID

from pydantic import BaseModel

from app.core.clock import Clock
from app.core.config import Settings
from app.core.logging_config import get_logger
from app.core.tasks import cancel_and_wait
from app.engine.actions import Abandon
from app.engine.runner import legal_actions, view_for
from app.engine.seats import Seat
from app.schemas.room import (
    CloseCode,
    DeckProblem,
    GameStatePayload,
    RoomDeckSummary,
    RoomErrorReason,
    RoomPlayerOut,
    RoomRulesetOut,
    RoomState,
    ServerMessageType,
)
from app.services.room_store import Room, RoomStore, StaleRoom

log = get_logger(__name__)


class Notifier(Protocol):
    """Sends to one socket, by its connection id. Both only queue: they never block."""

    def send(
        self, conn_id: str, message_type: ServerMessageType, payload: BaseModel | None = None
    ) -> None: ...

    def close(self, conn_id: str, close_code: int) -> None: ...


class RoomError(Exception):
    """An expected refusal of a socket message: the sender gets `error` with this reason, and
    the room is as it was."""

    def __init__(
        self, reason: RoomErrorReason, message: str, problems: list[DeckProblem] | None = None
    ) -> None:
        super().__init__(message)
        self.reason: RoomErrorReason = reason
        self.message = message
        self.problems = problems


@dataclass(eq=False)
class LiveRoom:
    code: str
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # None before the first load, and once the room is gone (expired, closed or deleted).
    room: Room | None = None
    loaded: bool = False
    # Set by a load, until the next settle: players without a socket then count as away from
    # this moment, so time the server was down never counts against them.
    just_loaded: bool = False
    # user id -> connection id, one socket per member.
    connections: dict[UUID, str] = field(default_factory=dict)
    # The turn timer, for the deadline it waits for.
    timer: asyncio.Task[None] | None = None
    timer_deadline: int | None = None
    # user id -> (their away_since, the task that ends the game for them).
    away_tasks: dict[UUID, tuple[int, asyncio.Task[None]]] = field(default_factory=dict)
    # Closes a finished room's sockets when its key expires.
    finish_task: asyncio.Task[None] | None = None
    # How many `use()` blocks hold or wait for this room.
    holders: int = 0

    def tasks(self) -> list[asyncio.Task[None]]:
        """The room's pending tasks. The task running this code doesn't count: it is finishing,
        so it doesn't keep the room in memory."""
        tasks = [self.timer, self.finish_task, *(task for _, task in self.away_tasks.values())]
        current = asyncio.current_task()
        return [
            task for task in tasks if task is not None and not task.done() and task is not current
        ]


SettleHook = Callable[["LiveRooms", LiveRoom], Awaitable[None]]


class LiveRooms:
    def __init__(
        self,
        store: RoomStore,
        notifier: Notifier,
        clock: Clock,
        settings: Settings,
        settle: SettleHook,
        rng: random.Random,
    ) -> None:
        self.store = store
        self.notifier = notifier
        self.clock = clock
        self.settings = settings
        # Picks the seats and each game's seed: the OS's source (`secrets` uses the same) in
        # the app, a seeded one in tests.
        self.random = rng
        self._settle = settle
        self._rooms: dict[str, LiveRoom] = {}
        # Set at shutdown: sockets closing then change nothing in Redis.
        self.closing = False

    @asynccontextmanager
    async def use(self, code: str) -> AsyncGenerator[LiveRoom]:
        """Holds the room's lock, loading the room from Redis on its first use. `room` is None
        when there is no such room."""
        # The shell goes into the registry before any await, so concurrent first uses share
        # one lock (and one load).
        live = self._rooms.get(code)
        if live is None:
            live = self._rooms[code] = LiveRoom(code)
        live.holders += 1
        try:
            async with live.lock:
                if not live.loaded:
                    live.room = await self.store.load(code)
                    live.loaded = True
                    live.just_loaded = live.room is not None
                try:
                    yield live
                finally:
                    if live.room is not None and not self.closing:
                        await self._settle(self, live)
        finally:
            live.holders -= 1
            self._evict_if_idle(live)

    def peek(self, code: str) -> Room | None:
        """The cached room, without the lock (for log fields)."""
        live = self._rooms.get(code)
        return live.room if live is not None else None

    async def create(self, room: Room) -> Room:
        """Stores a new room (`RoomExists` if its code is taken)."""
        created = await self.store.create(room)
        live = self._rooms.get(room.code)
        if live is not None:
            # A shell left from a room that had this code before.
            async with live.lock:
                live.room, live.loaded, live.just_loaded = created, True, False
        return created

    async def save(self, live: LiveRoom, room: Room) -> Room:
        """Writes the room and caches it. When another write came first, the room is reloaded,
        both players get its fresh state, and the caller gets `RoomError("stale_state")`."""
        try:
            saved = await self.store.save(room)
        except StaleRoom as exc:
            await self._reload(live, missing=exc.missing)
            raise RoomError(
                "stale_state", "The room changed in the meantime; its current state was sent"
            ) from None
        live.room = saved
        return saved

    async def delete(self, live: LiveRoom, room: Room) -> None:
        try:
            await self.store.delete(room)
        except StaleRoom as exc:
            await self._reload(live, missing=exc.missing)
            raise RoomError(
                "stale_state", "The room changed in the meantime; its current state was sent"
            ) from None
        self.close_room(live)

    async def _reload(self, live: LiveRoom, missing: bool) -> None:
        fresh = None if missing else await self.store.load(live.code)
        if fresh is None:
            self.close_room(live)
            return
        live.room = fresh
        for user_id in list(live.connections):
            self.send_full_state(live, user_id)

    def close_room(self, live: LiveRoom) -> None:
        """The room is gone: every socket gets `room_closed`, then closes."""
        for conn_id in live.connections.values():
            self.notifier.send(conn_id, "room_closed")
            self.notifier.close(conn_id, CloseCode.NORMAL)
        live.connections.clear()
        live.room = None
        live.loaded = True
        for task in live.tasks():
            cancel_unless_current(task)
        live.timer, live.timer_deadline, live.finish_task = None, None, None
        live.away_tasks.clear()

    # --- Sending ---

    def send(
        self,
        live: LiveRoom,
        user_id: UUID,
        message_type: ServerMessageType,
        payload: BaseModel | None = None,
    ) -> None:
        conn_id = live.connections.get(user_id)
        if conn_id is not None:
            self.notifier.send(conn_id, message_type, payload)

    def send_room_state(self, live: LiveRoom, skip: UUID | None = None) -> None:
        """Every connected member (but `skip`) gets the room as they see it."""
        room = live.room
        if room is None:
            return
        for user_id in live.connections:
            if user_id != skip:
                payload = room_state_for(room, user_id, live.connections)
                self.send(live, user_id, "room_state", payload)

    def send_full_state(self, live: LiveRoom, user_id: UUID) -> None:
        """`room_state`, and `game_state` once a game has started: what a socket gets when it
        connects or asks for a resync."""
        room = live.room
        if room is None:
            return
        self.send(live, user_id, "room_state", room_state_for(room, user_id, live.connections))
        member = room.member(user_id)
        if room.state is not None and member is not None and member.seat is not None:
            payload = game_state_for(room, member.seat, self.clock.now_ms())
            self.send(live, user_id, "game_state", payload)

    # --- Lifetime ---

    def _evict_if_idle(self, live: LiveRoom) -> None:
        """Forgets a room nothing uses: Redis still has it, and the next use loads it again."""
        idle = live.holders == 0 and not live.connections and not live.tasks()
        if idle and self._rooms.get(live.code) is live:
            del self._rooms[live.code]

    async def aclose(self) -> None:
        """Stops every room's tasks, before the Redis client closes."""
        self.closing = True
        tasks = [task for live in self._rooms.values() for task in live.tasks()]
        for task in tasks:
            await cancel_and_wait(task)
        self._rooms.clear()


def cancel_unless_current(task: asyncio.Task[None] | None) -> None:
    """Cancels a room task, unless it is the one running this code: a timer that sets the next
    deadline replaces itself, and must not abort its own write."""
    if task is not None and task is not asyncio.current_task():
        task.cancel()


def room_state_for(room: Room, viewer: UUID, connected: Collection[UUID]) -> RoomState:
    me = room.member(viewer)
    my_deck = None
    if me is not None and me.deck is not None:
        snapshot = me.deck.snapshot
        my_deck = RoomDeckSummary(
            id=me.deck.id,
            name=me.deck.name,
            origin_id=UUID(snapshot.origin.origin_id),
            card_count=len(snapshot.cards),
        )
    players = [
        RoomPlayerOut(
            user_id=member.user_id,
            username=member.username,
            is_host=member.user_id == room.host.user_id,
            connected=member.user_id in connected,
            has_deck=member.deck is not None,
            ready=member.ready,
            seat=member.seat,
            away_since=member.away_since,
        )
        for member in room.members()
    ]
    ruleset = RoomRulesetOut(
        id=room.ruleset.id, name=room.ruleset.name, definition=room.ruleset.definition
    )
    return RoomState(
        code=room.code, status=room.status, ruleset=ruleset, players=players, my_deck=my_deck
    )


def game_state_for(room: Room, seat: Seat, now_ms: int) -> GameStatePayload:
    state = room.state
    if state is None:
        raise ValueError("The room has no game")
    # `legal_actions` never lists Abandon; the filter only narrows the type.
    actions = [action for action in legal_actions(state, seat) if not isinstance(action, Abandon)]
    return GameStatePayload(
        view=view_for(state, seat),
        legal_actions=actions,
        deadline=room.deadline,
        server_time=now_ms,
    )
