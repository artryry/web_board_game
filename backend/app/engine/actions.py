"""What players send (backend_plan §7.4), the targets in them, and `IllegalAction`.

Every model is frozen, so `legal_actions` entries compare and hash by value.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from app.engine.seats import Seat

# The action kinds an interactive phase can allow (`action_phase.allow`).
ActionKind = Literal["play", "move", "attack"]


class _Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SlotRef(_Frozen):
    kind: Literal["slot"] = "slot"
    seat: Seat
    lane: int
    slot: int


class SectionRef(_Frozen):
    kind: Literal["section"] = "section"
    seat: Seat
    lane: int


class CreatureRef(_Frozen):
    kind: Literal["creature"] = "creature"
    uid: str


class CreatureToSlotRef(_Frozen):
    """A creature and the slot it goes to (`move_enemy`)."""

    kind: Literal["creature_to_slot"] = "creature_to_slot"
    uid: str
    to: SlotRef


Target = Annotated[
    SlotRef | SectionRef | CreatureRef | CreatureToSlotRef, Field(discriminator="kind")
]
AttackTarget = Annotated[CreatureRef | SectionRef, Field(discriminator="kind")]


class PlayCard(_Frozen):
    type: Literal["play_card"] = "play_card"
    card_uid: str
    # A slot for a creature; for a spell, one of its targets, or none.
    target: Target | None = None


class Move(_Frozen):
    type: Literal["move"] = "move"
    creature_uid: str
    to: SlotRef


class Attack(_Frozen):
    type: Literal["attack"] = "attack"
    creature_uid: str
    target: AttackTarget


class EndPhase(_Frozen):
    """Ends an interactive phase. In an `actor: both` phase it means the player is ready."""

    type: Literal["end_phase"] = "end_phase"


class Surrender(_Frozen):
    type: Literal["surrender"] = "surrender"


Action = Annotated[PlayCard | Move | Attack | EndPhase | Surrender, Field(discriminator="type")]

# Parses an action from a client message (M6).
action_adapter: TypeAdapter[Action] = TypeAdapter(Action)

IllegalReason = Literal[
    "game_over",
    "not_your_turn",
    "not_allowed_now",
    "unknown_card",
    "not_enough_mana",
    "slot_occupied",
    "invalid_target",
    "creature_exhausted",
    "already_moved",
    "engine_limit",
]


class IllegalAction(Exception):
    """An action the engine refuses. The state it was given is unchanged."""

    def __init__(self, reason: IllegalReason, message: str) -> None:
        super().__init__(message)
        self.reason: IllegalReason = reason
        self.message = message
