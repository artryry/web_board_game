"""A room's game (backend_plan §9.3): the start, players' actions, the turn timer, players who
stay away, and the end.

Every change runs the engine on the room's state under the room's lock, writes the room, then
sends each connected player their own `events` and `game_state`. The timer and away rules are
kept by `settle`, which runs after every use of a room (`LiveRooms.use`): it re-arms the turn
timer for the stored deadline and the away tasks for the stored `away_since`s, so they also come
back after a restart, when the room is loaded again.
"""

import asyncio
import time
from collections.abc import Awaitable, Callable
from uuid import UUID, uuid4

from redis.exceptions import RedisError

from app.core.logging_config import elapsed_ms, get_logger
from app.core.tasks import spawn
from app.engine.actions import Abandon, Action, EndPhase, IllegalAction, PlayerAction
from app.engine.events import Event
from app.engine.runner import apply_action, events_for, legal_actions, start_game, view_for
from app.engine.seats import SEATS, Seat
from app.engine.state import GameState
from app.schemas.room import EventsPayload, GameOverPayload
from app.services.live_rooms import (
    LiveRoom,
    LiveRooms,
    RoomError,
    cancel_unless_current,
    game_state_for,
)
from app.services.room_store import Room

log = get_logger(__name__)

# How long a timer task waits before it tries again when Redis fails, at most.
MAX_RETRY_DELAY_MS = 30_000

# The receiver of `events.seq`: the player whose message caused the change, and its seq.
Sender = tuple[UUID, int]


# --- The start ---


async def start(rooms: LiveRooms, live: LiveRoom, room: Room, sender: Sender) -> None:
    """Starts the game of a lobby where both players have a deck and are ready. `room` is the
    lobby with the last ready flag set, not written yet."""
    host, guest = room.host, room.guest
    if guest is None or host.deck is None or guest.deck is None:
        raise ValueError("Both players need a deck to start")
    # A coin flip for the seats: seat 0 goes first. The seed decides the shuffle.
    host_seat: Seat = 0 if rooms.random.randrange(2) == 0 else 1
    by_seat = (host, guest) if host_seat == 0 else (guest, host)
    decks = (by_seat[0].deck, by_seat[1].deck)
    assert decks[0] is not None and decks[1] is not None
    seed = rooms.random.getrandbits(63)
    game_id = uuid4()
    state, events = start_game(
        room.ruleset.definition, (decks[0].snapshot, decks[1].snapshot), seed
    )

    now = rooms.clock.now_ms()
    started = room.model_copy(
        update={
            "status": "playing",
            "host": host.model_copy(update={"seat": host_seat}),
            "guest": guest.model_copy(update={"seat": 1 - host_seat}),
            "game_id": game_id,
            "state": state,
            "deadline": _deadline(state, now),
            "started_at": now,
        }
    )
    saved = await rooms.save(live, started)
    log.info(
        "game.started",
        game_id=game_id,
        seat_0=by_seat[0].user_id,
        seat_1=by_seat[1].user_id,
    )
    rooms.send_room_state(live)
    _send_changes(rooms, live, saved, events, sender)


# --- Actions ---


async def player_action(
    rooms: LiveRooms, code: str, user_id: UUID, seq: int, action: PlayerAction
) -> None:
    async with rooms.use(code) as live:
        room = live.room
        if room is None or room.status == "lobby":
            raise RoomError("not_in_game", "The game hasn't started")
        if room.status == "finished":
            raise RoomError("game_over", "The game is over")
        member = room.member(user_id)
        if member is None or member.seat is None:
            raise RoomError("not_in_game", "You aren't playing in this game")
        started = time.perf_counter()
        try:
            saved = await _apply(rooms, live, [(member.seat, action)], (user_id, seq))
        except IllegalAction as exc:
            log.info("game.action_rejected", reason=exc.reason, type=action.type)
            raise RoomError(exc.reason, exc.message) from None
        if saved.state is not None:
            log.debug(
                "game.action_applied",
                type=action.type,
                version=saved.state.version,
                duration_ms=elapsed_ms(started),
            )


async def _apply(
    rooms: LiveRooms, live: LiveRoom, moves: list[tuple[Seat, Action]], sender: Sender | None
) -> Room:
    """Applies the moves in order, writes the room and tells both players. Raises
    `IllegalAction` (nothing changed) or `RoomError("stale_state")`."""
    room = live.room
    if room is None or room.state is None:
        raise ValueError("The room has no game")
    state = room.state
    events: list[Event] = []
    for seat, action in moves:
        state, new_events = apply_action(state, seat, action)
        events += new_events

    now = rooms.clock.now_ms()
    update: dict[str, object] = {"state": state, "deadline": _next_deadline(room, state, now)}
    if state.status == "finished":
        update |= {"status": "finished", "ended_at": now}
    saved = await rooms.save(live, room.model_copy(update=update))
    _send_changes(rooms, live, saved, events, sender)
    if saved.status == "finished":
        _send_game_over(rooms, live, saved)
    return saved


def _send_changes(
    rooms: LiveRooms, live: LiveRoom, room: Room, events: list[Event], sender: Sender | None
) -> None:
    """Each connected player gets their own events, then their game state."""
    now = rooms.clock.now_ms()
    for member in room.members():
        if member.seat is None:
            continue
        seq = sender[1] if sender is not None and sender[0] == member.user_id else None
        payload = EventsPayload(seq=seq, events=events_for(events, member.seat))
        rooms.send(live, member.user_id, "events", payload)
        rooms.send(live, member.user_id, "game_state", game_state_for(room, member.seat, now))


def _send_game_over(rooms: LiveRooms, live: LiveRoom, room: Room) -> None:
    state = room.state
    if state is None or state.end_reason is None:
        raise ValueError("The game isn't over")
    payload = GameOverPayload(winner=state.winner, reason=state.end_reason)
    for member in room.members():
        rooms.send(live, member.user_id, "game_over", payload)
    rooms.send_room_state(live)
    log.info(
        "game.ended",
        game_id=room.game_id,
        winner=state.winner,
        end_reason=state.end_reason,
        turn_number=state.turn_number,
        actions=len(state.log),
    )


# --- Deadlines ---


def _phase_key(state: GameState) -> tuple[int, str, int]:
    return state.turn_number, state.phase.pipeline, state.phase.index


def _deadline(state: GameState, now_ms: int) -> int | None:
    """When the current phase ends on its own: an interactive phase's time limit from now."""
    if state.status != "playing":
        return None
    phase = view_for(state, 0).phase
    if not phase.interactive or phase.time_limit_s is None:
        return None
    return now_ms + phase.time_limit_s * 1000


def _next_deadline(room: Room, state: GameState, now_ms: int) -> int | None:
    """Actions inside a phase don't move its deadline; a new phase gets a new one."""
    if room.state is not None and state.status == "playing":
        if _phase_key(state) == _phase_key(room.state):
            return room.deadline
    return _deadline(state, now_ms)


# --- Settling a room: away flags and tasks ---


async def settle(rooms: LiveRooms, live: LiveRoom) -> None:
    """Runs after every use of a room, under its lock. In a game, a member without a socket is
    away (from now, or from the load after a restart) and one with a socket isn't; the turn
    timer and the away tasks follow the stored deadline and `away_since`s."""
    for _ in range(3):
        try:
            await _settle_once(rooms, live)
            return
        except RoomError:
            # A write lost to another instance's: the room was reloaded, so settle it again.
            continue
        except RedisError:
            log.warning("room.settle_failed", room_code=live.code, exc_info=True)
            return


async def _settle_once(rooms: LiveRooms, live: LiveRoom) -> None:
    room = live.room
    just_loaded, live.just_loaded = live.just_loaded, False
    if room is None:
        return
    if room.status == "playing":
        room = await _update_away(rooms, live, room, just_loaded)
    _sync_turn_timer(rooms, live, room)
    _sync_away_tasks(rooms, live, room)
    _sync_finish_task(rooms, live, room)


async def _update_away(rooms: LiveRooms, live: LiveRoom, room: Room, just_loaded: bool) -> Room:
    now = rooms.clock.now_ms()
    updated = room
    for member in room.members():
        connected = member.user_id in live.connections
        if connected and member.away_since is not None:
            updated = updated.with_member(member.model_copy(update={"away_since": None}))
            # user_id: the player who came back (a line may come from the other's socket).
            log.info("game.player_back", game_id=room.game_id, user_id=member.user_id)
        elif not connected and (member.away_since is None or just_loaded):
            updated = updated.with_member(member.model_copy(update={"away_since": now}))
            log.info(
                "game.player_away",
                game_id=room.game_id,
                user_id=member.user_id,
                after_restart=just_loaded,
            )
    if updated is room:
        return room
    saved = await rooms.save(live, updated)
    rooms.send_room_state(live)
    return saved


def _sync_turn_timer(rooms: LiveRooms, live: LiveRoom, room: Room) -> None:
    wanted = room.deadline if room.status == "playing" else None
    if wanted == live.timer_deadline and (wanted is None or live.timer is not None):
        return
    cancel_unless_current(live.timer)
    live.timer, live.timer_deadline = None, None
    if wanted is not None:
        live.timer = spawn(
            _turn_timer(rooms, live.code, wanted),
            name="room.timer",
            room_code=live.code,
            game_id=str(room.game_id),
        )
        live.timer_deadline = wanted


def _sync_away_tasks(rooms: LiveRooms, live: LiveRoom, room: Room) -> None:
    away = {
        member.user_id: member.away_since
        for member in room.members()
        if room.status == "playing" and member.away_since is not None
    }
    for user_id, (since, task) in list(live.away_tasks.items()):
        if away.get(user_id) != since:
            cancel_unless_current(task)
            del live.away_tasks[user_id]
    for user_id, since in away.items():
        if user_id not in live.away_tasks:
            task = spawn(
                _forfeit(rooms, live.code, user_id, since),
                name="room.away",
                room_code=live.code,
                game_id=str(room.game_id),
            )
            live.away_tasks[user_id] = (since, task)


def _sync_finish_task(rooms: LiveRooms, live: LiveRoom, room: Room) -> None:
    if room.status != "finished" or room.ended_at is None or live.finish_task is not None:
        return
    closes_at = room.ended_at + rooms.settings.finished_room_ttl_min * 60_000
    live.finish_task = spawn(
        _close_finished(rooms, live.code, closes_at),
        name="room.finish",
        room_code=live.code,
        game_id=str(room.game_id),
    )


# --- The tasks ---


async def _retrying(rooms: LiveRooms, attempt: Callable[[], Awaitable[None]]) -> None:
    """Runs a task's step; when Redis fails, waits and tries again (the step re-checks that it
    is still wanted)."""
    delay_ms = 1000
    while True:
        try:
            await attempt()
            return
        except RedisError:
            log.warning("room.task_retry", delay_ms=delay_ms, exc_info=True)
        await rooms.clock.sleep_until(rooms.clock.now_ms() + delay_ms)
        delay_ms = min(delay_ms * 2, MAX_RETRY_DELAY_MS)


async def _turn_timer(rooms: LiveRooms, code: str, deadline: int) -> None:
    await rooms.clock.sleep_until(deadline)

    async def end_phase() -> None:
        async with rooms.use(code) as live:
            room = live.room
            if live.timer is not asyncio.current_task() or room is None:
                return  # replaced by a newer deadline, or the room is gone
            if room.status != "playing" or room.deadline != deadline or room.state is None:
                return
            await _end_phase_at_deadline(rooms, live, room, room.state)

    try:
        await _retrying(rooms, end_phase)
    except RoomError as exc:
        # The room changed under this timer; it was reloaded and settled.
        log.debug("timer.skipped", reason=exc.reason)


async def _end_phase_at_deadline(
    rooms: LiveRooms, live: LiveRoom, room: Room, state: GameState
) -> None:
    """`end_phase` for every seat that can still end the phase: the active seat, or in an
    `actor: both` phase each seat that isn't ready. They go in the log as each seat's own."""
    seats: list[Seat] = [seat for seat in SEATS if EndPhase() in legal_actions(state, seat)]
    phase = view_for(state, 0).phase
    log.info("timer.expired", phase=phase.key, phase_index=phase.index, seats=seats)
    if not seats:
        # Nothing can end the phase (it shouldn't happen): drop the deadline, so the timer
        # doesn't fire again and again.
        await rooms.save(live, room.model_copy(update={"deadline": None}))
        return
    moves: list[tuple[Seat, Action]] = [(seat, EndPhase()) for seat in seats]
    await _apply(rooms, live, moves, None)


async def _forfeit(rooms: LiveRooms, code: str, user_id: UUID, away_since: int) -> None:
    await rooms.clock.sleep_until(away_since + rooms.settings.disconnect_forfeit_s * 1000)

    async def abandon() -> None:
        async with rooms.use(code) as live:
            entry = live.away_tasks.get(user_id)
            room = live.room
            if entry is None or entry[1] is not asyncio.current_task() or room is None:
                return
            member = room.member(user_id)
            if room.status != "playing" or member is None or member.seat is None:
                return
            if member.away_since != away_since or user_id in live.connections:
                return
            await _apply(rooms, live, [(member.seat, Abandon())], None)

    try:
        await _retrying(rooms, abandon)
    except RoomError as exc:
        log.debug("game.forfeit_skipped", reason=exc.reason)


async def _close_finished(rooms: LiveRooms, code: str, closes_at: int) -> None:
    """A finished room's key expires now: its sockets get `room_closed`."""
    await rooms.clock.sleep_until(closes_at)
    async with rooms.use(code) as live:
        if live.finish_task is asyncio.current_task():
            live.finish_task = None
            rooms.close_room(live)
