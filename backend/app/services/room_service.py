"""Rooms (backend_plan §9.1): creating and joining one, its lobby, and the sockets of its
players. The game itself is `game_service`'s."""

import random
from typing import Literal
from uuid import UUID

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import Clock
from app.core.codes import random_code
from app.core.config import Settings
from app.core.db import SessionFactory
from app.core.errors import AppError
from app.core.logging_config import get_logger
from app.models.origin import Origin
from app.models.user import User
from app.schemas.common import PageParams
from app.schemas.room import CloseCode, RoomDeckOut, RoomState
from app.services import deck_service, game_service, origin_service, ruleset_service
from app.services.live_rooms import LiveRoom, LiveRooms, Notifier, RoomError, room_state_for
from app.services.room_store import (
    Room,
    RoomExists,
    RoomMember,
    RoomStore,
    StoredDeck,
    StoredRuleset,
)

log = get_logger(__name__)

ROOM_CODE_LENGTH = 6
_MAX_CODE_ATTEMPTS = 5

ConnectResult = Literal["ok", "not_found", "not_member"]


def create_room_runtime(
    redis: Redis,
    settings: Settings,
    clock: Clock,
    notifier: Notifier,
    rng: random.Random | None = None,
) -> LiveRooms:
    """The live rooms of this process. The app's lifespan creates them, and the tests do too
    (with a seeded `rng`, so seats and shuffles repeat)."""
    return LiveRooms(
        RoomStore(redis, settings),
        notifier,
        clock,
        settings,
        game_service.settle,
        rng or random.SystemRandom(),
    )


def normalize_code(code: str) -> str:
    return code.strip().upper()


def _not_found() -> AppError:
    return AppError(404, "room_not_found", "Room not found")


# --- REST ---


async def create_room(
    rooms: LiveRooms, db: AsyncSession, user: User, ruleset_id: UUID
) -> RoomState:
    ruleset = await ruleset_service.get_ruleset(db, user.id, ruleset_id)
    # Checked again: a stored ruleset stops validating when a module it uses changes.
    definition = ruleset_service.checked_definition(ruleset.definition)
    stored = StoredRuleset(id=ruleset.id, name=ruleset.name, definition=definition)
    host = RoomMember(user_id=user.id, username=user.username)
    for attempt in range(1, _MAX_CODE_ATTEMPTS + 1):
        room = Room(code=random_code(ROOM_CODE_LENGTH), ruleset=stored, host=host)
        try:
            created = await rooms.create(room)
        except RoomExists:
            log.debug("room.code_retry", attempt=attempt)
            continue
        log.info("room.created", room_code=created.code, ruleset_id=ruleset.id)
        return room_state_for(created, user.id, ())
    raise RuntimeError("No free room code after several attempts")


async def join_room(rooms: LiveRooms, user: User, code: str) -> RoomState:
    async with rooms.use(normalize_code(code)) as live:
        room = live.room
        if room is None:
            raise _not_found()
        if room.member(user.id) is None:
            if room.status != "lobby" or room.guest is not None:
                raise AppError(409, "room_full", "This room already has two players")
            guest = RoomMember(user_id=user.id, username=user.username)
            room = await rooms.save(live, room.model_copy(update={"guest": guest}))
            log.info("room.joined", room_code=room.code)
            rooms.send_room_state(live)
        return room_state_for(room, user.id, live.connections)


async def get_room(rooms: LiveRooms, user_id: UUID, code: str) -> RoomState:
    async with rooms.use(normalize_code(code)) as live:
        room = live.room
        if room is None or room.member(user_id) is None:
            raise _not_found()
        return room_state_for(room, user_id, live.connections)


async def room_decks(
    rooms: LiveRooms,
    db: AsyncSession,
    user_id: UUID,
    code: str,
    page: PageParams,
) -> tuple[list[RoomDeckOut], int]:
    """The user's decks, each with what keeps it from being picked under the room's ruleset."""
    async with rooms.use(normalize_code(code)) as live:
        room = live.room
        if room is None or room.member(user_id) is None:
            raise _not_found()
        rules = room.ruleset.definition.deck
    decks, total = await deck_service.list_decks(db, user_id, page, with_cards=True)
    neutral_id = await origin_service.neutral_origin_id(db)
    items = [
        RoomDeckOut(
            id=deck.id,
            name=deck.name,
            origin_id=deck.origin_id,
            card_count=deck.card_count,
            problems=deck_service.deck_problems(deck, rules, neutral_id),
        )
        for deck in decks
    ]
    return items, total


# --- Sockets ---


async def connect(rooms: LiveRooms, code: str, user_id: UUID, conn_id: str) -> ConnectResult:
    """Makes `conn_id` the member's socket and sends it the room (and the game). A member's
    older socket is closed."""
    async with rooms.use(code) as live:
        room = live.room
        if room is None:
            return "not_found"
        if room.member(user_id) is None:
            return "not_member"
        replaced = live.connections.get(user_id)
        live.connections[user_id] = conn_id
        if replaced is not None:
            rooms.notifier.close(replaced, CloseCode.REPLACED)
            log.debug("ws.replaced")
        try:
            await _back_in_game(rooms, live, room, user_id)
        except RoomError:
            return "ok"  # reloaded: every socket, this one too, got the fresh state
        rooms.send_room_state(live, skip=user_id)
        rooms.send_full_state(live, user_id)
        return "ok"


async def _back_in_game(rooms: LiveRooms, live: LiveRoom, room: Room, user_id: UUID) -> None:
    """A player who was away from the game is back: their countdown stops. (Settle would
    clear it too, but only after this socket got its first messages.)"""
    member = room.member(user_id)
    if room.status != "playing" or member is None or member.away_since is None:
        return
    await rooms.save(live, room.with_member(member.model_copy(update={"away_since": None})))
    log.info("game.player_back", game_id=room.game_id, user_id=user_id)


async def disconnect(rooms: LiveRooms, code: str, user_id: UUID, conn_id: str) -> None:
    """The socket closed. In the lobby the player is no longer ready, so a game only starts with
    both players there; in a game, settle marks them away."""
    async with rooms.use(code) as live:
        if live.connections.get(user_id) != conn_id:
            return  # replaced by a newer socket, or never joined
        del live.connections[user_id]
        room = live.room
        if room is None or rooms.closing:
            return
        if room.status == "playing":
            return  # settle marks the player away and tells the opponent
        member = room.member(user_id)
        if room.status == "lobby" and member is not None and member.ready:
            try:
                await rooms.save(live, room.with_member(member.model_copy(update={"ready": False})))
            except RoomError:
                return  # reloaded; the others got the fresh state
        rooms.send_room_state(live)


async def resync(rooms: LiveRooms, code: str, user_id: UUID) -> None:
    async with rooms.use(code) as live:
        rooms.send_full_state(live, user_id)
    log.debug("ws.resync")


# --- The lobby ---


def _lobby_member(live: LiveRoom, user_id: UUID) -> tuple[Room, RoomMember]:
    room = live.room
    if room is None or room.status != "lobby":
        raise RoomError("not_in_lobby", "The game has already started")
    member = room.member(user_id)
    if member is None:
        raise RoomError("not_in_lobby", "You aren't in this room")
    return room, member


async def select_deck(
    rooms: LiveRooms,
    session_factory: SessionFactory,
    settings: Settings,
    code: str,
    user_id: UUID,
    deck_id: UUID,
) -> None:
    async with rooms.use(code) as live:
        room, _ = _lobby_member(live, user_id)
        rules = room.ruleset.definition.deck

    # The database is read outside the room's lock (see live_rooms).
    async with session_factory() as db:
        try:
            deck = await deck_service.get_deck(db, user_id, deck_id)
        except AppError as exc:
            raise RoomError("deck_not_found", exc.message) from None
        problems = deck_service.deck_problems(
            deck, rules, await origin_service.neutral_origin_id(db)
        )
        if problems:
            raise RoomError("deck_not_playable", "This deck doesn't fit the room's rules", problems)
        origin = await db.get(Origin, deck.origin_id)
        if origin is None:
            raise RuntimeError("A deck's origin is missing")
        stored = StoredDeck(
            id=deck.id, name=deck.name, snapshot=deck_service.deck_snapshot(deck, origin, settings)
        )

    async with rooms.use(code) as live:
        room, member = _lobby_member(live, user_id)
        # A new deck needs a new "ready".
        updated = member.model_copy(update={"deck": stored, "ready": False})
        await rooms.save(live, room.with_member(updated))
        rooms.send_room_state(live)
    log.debug("room.deck_selected", deck_id=deck_id)


async def set_ready(rooms: LiveRooms, code: str, user_id: UUID, seq: int, ready: bool) -> None:
    """The game starts as soon as both players have a deck and are ready."""
    async with rooms.use(code) as live:
        room, member = _lobby_member(live, user_id)
        if ready and member.deck is None:
            raise RoomError("no_deck", "Select a deck first")
        room = room.with_member(member.model_copy(update={"ready": ready}))
        if room.guest is not None and all(m.ready and m.deck for m in room.members()):
            await game_service.start(rooms, live, room, (user_id, seq))
            return
        await rooms.save(live, room)
        rooms.send_room_state(live)


async def leave(rooms: LiveRooms, code: str, user_id: UUID) -> None:
    """In the lobby: the guest frees their seat; the host closes the room. (In a game a player
    leaves by surrendering.)"""
    async with rooms.use(code) as live:
        room, member = _lobby_member(live, user_id)
        is_host = member.user_id == room.host.user_id
        if is_host:
            # Every socket, the host's too, gets room_closed and closes.
            await rooms.delete(live, room)
        else:
            await rooms.save(live, room.model_copy(update={"guest": None}))
            conn_id = live.connections.pop(user_id, None)
            if conn_id is not None:
                rooms.notifier.close(conn_id, CloseCode.NORMAL)
            rooms.send_room_state(live)
    log.info("room.left", host=is_host)
