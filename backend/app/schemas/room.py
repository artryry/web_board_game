"""Rooms (backend_plan §8, §9): the REST bodies, and the payloads of the game socket's messages.

The socket's payloads live here, not in `ws/`, because the services build them (a service never
imports `ws/`). `ws/protocol.py` wraps them in `{type, seq, payload}` envelopes.
"""

from enum import IntEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.engine.actions import IllegalReason, PlayerAction
from app.engine.events import Event
from app.engine.seats import Seat
from app.engine.state import EndReason
from app.engine.views import PlayerView
from app.schemas.rules import RulesetDefinition

RoomStatus = Literal["lobby", "playing", "finished"]

# A room code as typed: lower case and surrounding spaces are fine, as for share codes.
RoomCode = Annotated[
    str, StringConstraints(strip_whitespace=True, to_upper=True, min_length=1, max_length=16)
]


class _Out(BaseModel):
    # Responses always carry every field, so the generated frontend types mark them required
    # (the `kind` discriminators included).
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


# --- Deck problems: a deck checked against a ruleset's `deck` rules ---


class ProblemCard(_Out):
    id: UUID
    name: str


class SizeProblem(_Out):
    """The deck needs exactly `size` cards and has `count`."""

    kind: Literal["size"] = "size"
    count: int
    size: int


class CopiesProblem(_Out):
    """Cards with more than `max` copies."""

    kind: Literal["copies"] = "copies"
    max: int
    cards: list[ProblemCard]


class NeutralProblem(_Out):
    """Neutral cards in a deck of another origin, when the rules don't allow them."""

    kind: Literal["neutral"] = "neutral"
    cards: list[ProblemCard]


DeckProblem = Annotated[SizeProblem | CopiesProblem | NeutralProblem, Field(discriminator="kind")]


# --- REST ---


class RoomCreate(BaseModel):
    ruleset_id: UUID


class RoomJoin(BaseModel):
    code: RoomCode


class RoomRulesetOut(_Out):
    """The ruleset as it was copied when the room was created."""

    id: UUID
    name: str
    definition: RulesetDefinition


class RoomPlayerOut(_Out):
    user_id: UUID
    username: str
    is_host: bool
    connected: bool
    # The deck itself is shown only to its owner, until the game starts.
    has_deck: bool
    ready: bool
    # Null until the game starts; seat 0 goes first.
    seat: Seat | None
    # Unix ms when the player's socket closed during a game; null while they are here.
    away_since: int | None


class RoomDeckSummary(_Out):
    id: UUID
    name: str
    origin_id: UUID
    card_count: int


class RoomState(_Out):
    """What one player sees of a room: the REST answer and the socket's `room_state` payload."""

    code: str
    status: RoomStatus
    ruleset: RoomRulesetOut
    players: list[RoomPlayerOut]
    my_deck: RoomDeckSummary | None


class RoomDeckOut(RoomDeckSummary):
    """One of the user's decks, with what keeps it from being picked in this room."""

    problems: list[DeckProblem]


# --- The game socket ---


class CloseCode(IntEnum):
    """Why the server closed a game socket."""

    # The room closed (after `room_closed`), or the player left it.
    NORMAL = 1000
    # The server failed; the request middleware sends it.
    SERVER_ERROR = 1011
    # The client didn't read its messages fast enough; reconnect and resync.
    OVERLOADED = 1013
    # No valid `auth` in time, or the token is invalid or expired: refresh and reconnect.
    AUTH_FAILED = 4401
    # The user isn't a member of the room.
    NOT_MEMBER = 4403
    # No such room: unknown, expired or closed.
    ROOM_NOT_FOUND = 4404
    # The same user opened a newer socket to the room.
    REPLACED = 4409


ServerMessageType = Literal[
    "room_state", "game_state", "events", "error", "game_over", "room_closed", "pong"
]

RoomErrorReason = (
    IllegalReason
    | Literal[
        "bad_message",
        "not_in_lobby",
        "not_in_game",
        "deck_not_found",
        "deck_not_playable",
        "no_deck",
        "stale_state",
    ]
)


class GameStatePayload(_Out):
    view: PlayerView
    legal_actions: list[PlayerAction]
    # Unix ms when the current phase ends on its own; null outside interactive phases.
    deadline: int | None
    # The server's clock (Unix ms), so the client can correct its own before counting down.
    server_time: int


class EventsPayload(_Out):
    # The receiver's own message that caused these events; null for the opponent's actions and
    # the timer's.
    seq: int | None
    events: list[Event]


class ErrorPayload(_Out):
    seq: int | None
    reason: RoomErrorReason
    message: str
    # For `deck_not_playable`.
    problems: list[DeckProblem] | None = None


class GameOverPayload(_Out):
    # A seat, or null for a draw.
    winner: Seat | None
    reason: EndReason
