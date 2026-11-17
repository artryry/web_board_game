"""The game sockets of this process: each one by its connection id, with its own send queue.

The services decide who gets what (`services/live_rooms.py`) and call `send` and `close`, which
only queue, so they never block a room's lock: uvicorn's `send` waits while a client isn't
reading. A writer task per socket sends the queue in order, closes included.
"""

import asyncio
import contextlib
from dataclasses import dataclass, field
from uuid import uuid4

import anyio
from fastapi import WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.core.logging_config import get_logger
from app.schemas.room import CloseCode, ServerMessageType
from app.ws.protocol import encode_server_message

log = get_logger(__name__)

# Messages waiting for a slow client. A game state is up to tens of KB; past this the client
# has fallen far behind, so its socket closes, and it reconnects and resyncs.
QUEUE_LIMIT = 256

# What sending raises once the socket is gone: Starlette's disconnect (uvicorn), a send after
# the close (RuntimeError), or anyio's closed streams (ASGI test transports).
_GONE = (
    WebSocketDisconnect,
    RuntimeError,
    OSError,
    anyio.ClosedResourceError,
    anyio.BrokenResourceError,
)


@dataclass(eq=False)
class Connection:
    websocket: WebSocket
    id: str = field(default_factory=lambda: uuid4().hex)
    # Text frames to send, or a close code (the last item).
    queue: asyncio.Queue[str | int] = field(
        default_factory=lambda: asyncio.Queue(maxsize=QUEUE_LIMIT)
    )
    writer: asyncio.Task[None] | None = None
    # A close is queued: nothing more is.
    closing: bool = False


class ConnectionManager:
    """Implements `services.live_rooms.Notifier`."""

    def __init__(self) -> None:
        self._connections: dict[str, Connection] = {}

    def open(self, websocket: WebSocket) -> Connection:
        connection = Connection(websocket)
        # Not a background task (`core/tasks.spawn`): it belongs to the socket, and its lines
        # carry the socket's fields.
        connection.writer = asyncio.create_task(self._write(connection), name="ws.writer")
        self._connections[connection.id] = connection
        return connection

    async def finish(self, connection: Connection) -> None:
        """The socket's handler is done: stop its writer."""
        self._connections.pop(connection.id, None)
        if connection.writer is not None:
            connection.writer.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await connection.writer

    def send(
        self, conn_id: str, message_type: ServerMessageType, payload: BaseModel | None = None
    ) -> None:
        connection = self._connections.get(conn_id)
        if connection is None or connection.closing:
            return
        text = encode_server_message(message_type, payload)
        try:
            connection.queue.put_nowait(text)
        except asyncio.QueueFull:
            log.warning("ws.send_overflow", queued=connection.queue.qsize())
            self._queue_close(connection, CloseCode.OVERLOADED)

    def close(self, conn_id: str, close_code: int) -> None:
        connection = self._connections.get(conn_id)
        if connection is not None and not connection.closing:
            self._queue_close(connection, close_code)

    def _queue_close(self, connection: Connection, close_code: int) -> None:
        connection.closing = True
        if connection.queue.full():
            # The client is gone or stuck: what it hasn't read doesn't matter any more.
            while not connection.queue.empty():
                connection.queue.get_nowait()
        connection.queue.put_nowait(close_code)

    async def _write(self, connection: Connection) -> None:
        websocket = connection.websocket
        while True:
            item = await connection.queue.get()
            try:
                if isinstance(item, int):
                    await websocket.close(item)
                    return
                await websocket.send_text(item)
            except _GONE as exc:
                # The client went away first, or the socket is already closed: a normal race,
                # and the handler cleans up.
                log.debug("ws.send_failed", error=repr(exc))
                return
