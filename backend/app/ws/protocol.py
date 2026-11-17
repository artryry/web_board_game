"""The game socket's messages (backend_plan §9.2).

A client message is `{type, seq, payload}`: the client numbers its messages with `seq`, and the
server's `events` and `error` name the `seq` they answer. A server message is `{type, payload}`.
The payloads are in `schemas/room.py`, since the services build them.

These models are also published in the OpenAPI schema's components (`app/main.py`), so the
frontend gets their types from `npm run gen:api`.
"""

import json
from functools import lru_cache
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi.openapi.constants import REF_TEMPLATE
from fastapi.openapi.models import Schema
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter
from pydantic.json_schema import models_json_schema

from app.engine.actions import PlayerAction
from app.schemas.room import (
    ErrorPayload,
    EventsPayload,
    GameOverPayload,
    GameStatePayload,
    RoomState,
    ServerMessageType,
)


class _Client(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NoPayload(_Client):
    """The payload of a message that carries nothing: `{}` (or leave `payload` out)."""


class AuthPayload(_Client):
    # The access token, as for REST. It never goes in the URL, where proxies would log it.
    token: Annotated[str, Field(min_length=1, max_length=4096)]


class SelectDeckPayload(_Client):
    deck_id: UUID


class ReadyPayload(_Client):
    ready: bool


class AuthMessage(_Client):
    """The first message, within `WS_AUTH_TIMEOUT_S` of connecting."""

    type: Literal["auth"]
    seq: int
    payload: AuthPayload


class SelectDeckMessage(_Client):
    type: Literal["select_deck"]
    seq: int
    payload: SelectDeckPayload


class ReadyMessage(_Client):
    type: Literal["ready"]
    seq: int
    payload: ReadyPayload


class LeaveMessage(_Client):
    type: Literal["leave"]
    seq: int
    payload: NoPayload = Field(default_factory=NoPayload)


class ActionMessage(_Client):
    type: Literal["action"]
    seq: int
    payload: PlayerAction


class PingMessage(_Client):
    """Answered with `pong`, at no cost: send one about every 30 s, so idle proxies keep the
    socket open."""

    type: Literal["ping"]
    seq: int
    payload: NoPayload = Field(default_factory=NoPayload)


class ResyncMessage(_Client):
    """Asks for the full `room_state` and `game_state` again."""

    type: Literal["resync"]
    seq: int
    payload: NoPayload = Field(default_factory=NoPayload)


ClientMessage = Annotated[
    AuthMessage
    | SelectDeckMessage
    | ReadyMessage
    | LeaveMessage
    | ActionMessage
    | PingMessage
    | ResyncMessage,
    Field(discriminator="type"),
]
client_message_adapter: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


def parse_client_message(text: str) -> ClientMessage:
    """Raises pydantic's `ValidationError` for bad JSON, an unknown type or a bad payload."""
    return client_message_adapter.validate_json(text)


def message_seq(text: str) -> int | None:
    """The `seq` of a message that didn't parse, if it has one, for the `error` reply."""
    try:
        data = json.loads(text)
    except ValueError:
        return None
    seq = data.get("seq") if isinstance(data, dict) else None
    return seq if isinstance(seq, int) and not isinstance(seq, bool) else None


# --- Server messages ---


class _Server(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class RoomStateMessage(_Server):
    type: Literal["room_state"] = "room_state"
    payload: RoomState


class GameStateMessage(_Server):
    type: Literal["game_state"] = "game_state"
    payload: GameStatePayload


class EventsMessage(_Server):
    type: Literal["events"] = "events"
    payload: EventsPayload


class ErrorMessage(_Server):
    """A refused message: the room is as it was. It never closes the socket."""

    type: Literal["error"] = "error"
    payload: ErrorPayload


class GameOverMessage(_Server):
    type: Literal["game_over"] = "game_over"
    payload: GameOverPayload


class RoomClosedMessage(_Server):
    """The room is gone; the socket closes next, with 1000."""

    type: Literal["room_closed"] = "room_closed"
    payload: None = None


class PongMessage(_Server):
    type: Literal["pong"] = "pong"
    payload: None = None


ServerMessage = Annotated[
    RoomStateMessage
    | GameStateMessage
    | EventsMessage
    | ErrorMessage
    | GameOverMessage
    | RoomClosedMessage
    | PongMessage,
    Field(discriminator="type"),
]

_SERVER_MESSAGES: dict[ServerMessageType, type[_Server]] = {
    "room_state": RoomStateMessage,
    "game_state": GameStateMessage,
    "events": EventsMessage,
    "error": ErrorMessage,
    "game_over": GameOverMessage,
    "room_closed": RoomClosedMessage,
    "pong": PongMessage,
}


def encode_server_message(message_type: ServerMessageType, payload: BaseModel | None) -> str:
    """The JSON text of a server message. Building it through its model checks that the
    payload fits the type."""
    model = _SERVER_MESSAGES[message_type]
    return model.model_validate({"payload": payload}).model_dump_json()


# Published in the OpenAPI components for the frontend's generated types.
_MESSAGE_MODELS: tuple[type[BaseModel], ...] = (
    AuthMessage,
    SelectDeckMessage,
    ReadyMessage,
    LeaveMessage,
    ActionMessage,
    PingMessage,
    ResyncMessage,
    *_SERVER_MESSAGES.values(),
)


@lru_cache
def message_schemas() -> dict[str, Any]:
    """The JSON Schemas of every message and what they contain, by model name, as OpenAPI
    components. All in serialization mode, which is the wire format both ways (a client must
    send every discriminator), so no model gets an `-Input` and an `-Output` version."""
    _, top = models_json_schema(
        [(model, "serialization") for model in _MESSAGE_MODELS], ref_template=REF_TEMPLATE
    )
    definitions: dict[str, Any] = top["$defs"]
    # As FastAPI writes its own components (it drops null keywords such as `default: null`).
    return {
        name: Schema.model_validate(definition).model_dump(by_alias=True, exclude_none=True)
        for name, definition in definitions.items()
    }
