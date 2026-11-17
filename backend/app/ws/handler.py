"""`WS /ws/rooms/{code}`: a player's socket to their room (backend_plan §9.2).

1. Accept, then wait for `auth {token}` (the access token) within `WS_AUTH_TIMEOUT_S`. The token
   never goes in the URL. The socket stays logged in until it closes, even after the token
   expires; a reconnect needs a fresh one.
2. Join the room's live state: the socket gets `room_state` (and `game_state` in a game).
3. Read messages until the socket closes, handing each to a service. An expected refusal is an
   `error` message and never closes the socket.
"""

import asyncio
import time
from typing import Annotated
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, WebSocket
from pydantic import ValidationError
from starlette.requests import HTTPConnection
from starlette.types import Message

from app.core.clock import Clock
from app.core.deps import AppSettings, Rooms, Sessions
from app.core.errors import UnauthorizedError
from app.core.logging_config import elapsed_ms, get_logger
from app.core.security import TokenType
from app.schemas.room import CloseCode, ErrorPayload
from app.services import auth_service, game_service, room_service
from app.services.live_rooms import LiveRooms, RoomError
from app.ws.manager import Connection, ConnectionManager
from app.ws.protocol import (
    ActionMessage,
    AuthMessage,
    ClientMessage,
    LeaveMessage,
    PingMessage,
    ReadyMessage,
    ResyncMessage,
    SelectDeckMessage,
    message_seq,
    parse_client_message,
)

log = get_logger(__name__)

router = APIRouter()


def get_connections(conn: HTTPConnection) -> ConnectionManager:
    manager: ConnectionManager = conn.app.state.connections
    return manager


Connections = Annotated[ConnectionManager, Depends(get_connections)]


@router.websocket("/ws/rooms/{code}")
async def room_socket(
    websocket: WebSocket,
    code: str,
    rooms: Rooms,
    connections: Connections,
    sessions: Sessions,
    settings: AppSettings,
) -> None:
    code = room_service.normalize_code(code)
    structlog.contextvars.bind_contextvars(room_code=code)
    await websocket.accept()

    user_id = await _authenticate(websocket, rooms.clock, sessions, settings)
    if user_id is None:
        return
    structlog.contextvars.bind_contextvars(user_id=str(user_id))

    connection = connections.open(websocket)
    try:
        result = await room_service.connect(rooms, code, user_id, connection.id)
    except BaseException:
        # Redis is down, say: the middleware closes the socket with 1011.
        await connections.finish(connection)
        raise
    if result != "ok":
        await connections.finish(connection)
        refusal = CloseCode.ROOM_NOT_FOUND if result == "not_found" else CloseCode.NOT_MEMBER
        log.info("ws.auth_failed", code=refusal)
        await websocket.close(refusal)
        return

    session = _Session(rooms, connections, connection, sessions, settings, code, user_id)
    started = time.perf_counter()
    log.info("ws.connected")
    close_code: int | None = None
    try:
        close_code = await session.read_until_closed()
    finally:
        try:
            await room_service.disconnect(rooms, code, user_id, connection.id)
        finally:
            await connections.finish(connection)
            log.info("ws.closed", duration_ms=elapsed_ms(started), code=close_code)


async def _authenticate(
    websocket: WebSocket, clock: Clock, sessions: Sessions, settings: AppSettings
) -> UUID | None:
    """The user of the socket's `auth` message, or None (the socket is then closed)."""
    deadline = clock.now_ms() + round(settings.ws_auth_timeout_s * 1000)
    message = await _receive_before(websocket, clock, deadline)
    if message is not None and message["type"] == "websocket.disconnect":
        return None  # the client left before logging in

    reason = "timeout"
    if message is not None:
        reason = "bad_message"
        try:
            parsed = parse_client_message(message.get("text") or "")
        except ValidationError:
            parsed = None
        if isinstance(parsed, AuthMessage):
            try:
                async with sessions() as db:
                    user = await auth_service.user_from_token(
                        db, parsed.payload.token, TokenType.ACCESS, settings
                    )
                    return user.id
            except UnauthorizedError as exc:
                reason = exc.code

    log.info("ws.auth_failed", code=CloseCode.AUTH_FAILED, reason=reason)
    await websocket.close(CloseCode.AUTH_FAILED)
    return None


async def _receive_before(websocket: WebSocket, clock: Clock, deadline_ms: int) -> Message | None:
    """The next ASGI message, or None if the deadline passes first. Waits on the clock, so the
    tests can move time instead of sleeping."""
    receive = asyncio.ensure_future(websocket.receive())
    timeout = asyncio.ensure_future(clock.sleep_until(deadline_ms))
    try:
        done, _ = await asyncio.wait({receive, timeout}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        timeout.cancel()
        if not receive.done():
            receive.cancel()
    return receive.result() if receive in done else None


class _Session:
    """One logged-in socket: reads its messages and hands them to the services."""

    def __init__(
        self,
        rooms: LiveRooms,
        connections: ConnectionManager,
        connection: Connection,
        sessions: Sessions,
        settings: AppSettings,
        code: str,
        user_id: UUID,
    ) -> None:
        self.rooms = rooms
        self.connections = connections
        self.connection = connection
        self.sessions = sessions
        self.settings = settings
        self.code = code
        self.user_id = user_id

    async def read_until_closed(self) -> int | None:
        """Handles messages until the socket closes; returns its close code."""
        while True:
            message = await self.connection.websocket.receive()
            if message["type"] == "websocket.disconnect":
                code: int | None = message.get("code")
                return code
            text = message.get("text")
            if text is None:
                self._error(None, RoomError("bad_message", "Send JSON text frames"))
                continue
            try:
                parsed = parse_client_message(text)
            except ValidationError:
                error = RoomError("bad_message", "Not a valid message; see the protocol")
                self._error(message_seq(text), error)
                continue
            self._bind_game_id()
            try:
                await self._handle(parsed)
            except RoomError as exc:
                self._error(parsed.seq, exc)

    async def _handle(self, message: ClientMessage) -> None:
        rooms, code, user_id = self.rooms, self.code, self.user_id
        if isinstance(message, PingMessage):
            self.connections.send(self.connection.id, "pong")
        elif isinstance(message, ActionMessage):
            await game_service.player_action(rooms, code, user_id, message.seq, message.payload)
        elif isinstance(message, ResyncMessage):
            await room_service.resync(rooms, code, user_id)
        elif isinstance(message, SelectDeckMessage):
            await room_service.select_deck(
                rooms, self.sessions, self.settings, code, user_id, message.payload.deck_id
            )
        elif isinstance(message, ReadyMessage):
            await room_service.set_ready(rooms, code, user_id, message.seq, message.payload.ready)
        elif isinstance(message, LeaveMessage):
            await room_service.leave(rooms, code, user_id)
        elif isinstance(message, AuthMessage):
            raise RoomError("bad_message", "This socket is already logged in")

    def _error(self, seq: int | None, error: RoomError) -> None:
        payload = ErrorPayload(
            seq=seq, reason=error.reason, message=error.message, problems=error.problems
        )
        self.connections.send(self.connection.id, "error", payload)

    def _bind_game_id(self) -> None:
        # The game can start from the other player's message, so this is checked each time.
        room = self.rooms.peek(self.code)
        if room is not None and room.game_id is not None:
            structlog.contextvars.bind_contextvars(game_id=str(room.game_id))
