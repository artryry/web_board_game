"""The whole game as one JSON-serializable model (backend_plan §7.2). M6 keeps it in Redis.

Only the engine changes it, through `EngineContext`, and only on a copy (`GameState.clone`):
`apply_action` never changes the state it is given. A clone shares what is never changed in
place: the ruleset, snapshots, `ModuleRef`s, `CardInstance`s, `StatDelta`s and log entries. The
engine only ever replaces those, never edits them.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.engine.actions import Action
from app.engine.registry import NO_CHANGE, ModuleRef, StatDelta
from app.engine.seats import Seat
from app.engine.snapshots import CardSnapshot, OriginSnapshot
from app.schemas.rules import RulesetDefinition

Pipeline = Literal["setup", "turn"]
GameStatus = Literal["playing", "finished"]
# `abandoned`: the server ended the game for a player who stayed away (M6).
EndReason = Literal["conquered", "surrender", "out_of_cards", "abandoned"]


class _State(BaseModel):
    # The last flag only marks every field required in the output JSON Schema (for the
    # frontend's generated types, M6): the server always sends every field.
    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)


class _Shared(BaseModel):
    """A part that clones share, so it can't be changed in place."""

    model_config = ConfigDict(
        extra="forbid", frozen=True, json_schema_serialization_defaults_required=True
    )


class CardInstance(_Shared):
    """A card in a deck or a hand. Its uid (`p0-1`, `p0-2`, …) is given after the shuffle, so it
    says nothing about which card it is."""

    uid: str
    card: CardSnapshot


class CreatureInstance(_State):
    """A creature on the board. A creature played from the hand keeps its card's uid; tokens get
    `t1`, `t2`, …"""

    uid: str
    card: CardSnapshot
    owner: Seat
    hp: int
    max_hp: int
    dmg: int
    # The HP and DMG its section's field gives it right now, so a move or a conquest can take
    # them back.
    field_bonus: StatDelta = NO_CHANGE
    # No action left this turn: it attacked, moved (without free_move), or was just summoned.
    exhausted: bool = True
    has_moved: bool = False
    features: list[ModuleRef] = Field(default_factory=list)


class Section(_State):
    owner: Seat
    lane: int
    hp: int
    max_hp: int
    slots: list[CreatureInstance | None]
    # The opponent has taken it: it can't be damaged or healed, and its field gives no bonuses.
    conquered: bool = False


class PlayerState(_State):
    origin: OriginSnapshot
    # Top card first.
    deck: list[CardInstance] = Field(default_factory=list)
    # Oldest card first.
    hand: list[CardInstance] = Field(default_factory=list)
    mana: int = 0
    max_mana: int = 0
    # False until the player's first Gain mana, which gives `mana.start`.
    mana_started: bool = False


class PhasePointer(_State):
    pipeline: Pipeline
    index: int


class LoggedAction(_Shared):
    seat: Seat
    action: Action


class GameState(_State):
    ruleset: RulesetDefinition
    seed: int
    rng_state: int
    # 0 during Setup, then 1, 2, …
    turn_number: int = 0
    active_seat: Seat = 0
    phase: PhasePointer
    # Who has ended an `actor: both` phase; reset when an interactive phase starts.
    ready: list[bool] = Field(default_factory=lambda: [False, False])
    players: list[PlayerState]
    # sections[seat][lane]
    sections: list[list[Section]]
    status: GameStatus = "playing"
    # A seat, or None for a draw (or while playing).
    winner: Seat | None = None
    end_reason: EndReason | None = None
    next_uid: int = 1
    # +1 per applied action.
    version: int = 0
    log: list[LoggedAction] = Field(default_factory=list)

    def clone(self) -> "GameState":
        """A copy the engine can change without touching this state. It copies the parts the
        engine changes in place, and shares the rest (see the module docstring); a full deep copy
        took most of an action's time."""
        return self.model_copy(
            update={
                "phase": self.phase.model_copy(),
                "ready": list(self.ready),
                "players": [
                    player.model_copy(update={"deck": list(player.deck), "hand": list(player.hand)})
                    for player in self.players
                ],
                "sections": [
                    [
                        section.model_copy(
                            update={
                                "slots": [
                                    None if creature is None else creature.model_copy()
                                    for creature in section.slots
                                ]
                            }
                        )
                        for section in row
                    ]
                    for row in self.sections
                ],
                "log": list(self.log),
            }
        )
