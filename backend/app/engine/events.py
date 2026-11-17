"""What happened, in order (backend_plan §7.6). The frontend plays these as animations.

Events are copies: a creature in an event shows it as it was at that moment.
"""

from collections.abc import Sequence
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.engine.actions import AttackTarget, Target
from app.engine.seats import Seat
from app.engine.state import CardInstance, CreatureInstance, EndReason, Pipeline


class _Event(BaseModel):
    # The last flag only marks every field required in the output JSON Schema (for the
    # frontend's generated types, M6): the server always sends every field.
    model_config = ConfigDict(
        extra="forbid", frozen=True, json_schema_serialization_defaults_required=True
    )


class GameStarted(_Event):
    type: Literal["game_started"] = "game_started"


class TurnStarted(_Event):
    type: Literal["turn_started"] = "turn_started"
    seat: Seat
    turn_number: int


class PhaseChanged(_Event):
    type: Literal["phase_changed"] = "phase_changed"
    pipeline: Pipeline
    index: int
    key: str


class CardDrawn(_Event):
    """Hidden: only `seat` sees the card; `events_for` removes it for the other seat."""

    type: Literal["card_drawn"] = "card_drawn"
    seat: Seat
    card: CardInstance | None


class DeckEmpty(_Event):
    """A draw from an empty deck: nothing is drawn."""

    type: Literal["deck_empty"] = "deck_empty"
    seat: Seat


class CardDiscarded(_Event):
    """Hidden, like `card_drawn`."""

    type: Literal["card_discarded"] = "card_discarded"
    seat: Seat
    card: CardInstance | None


class ManaChanged(_Event):
    type: Literal["mana_changed"] = "mana_changed"
    seat: Seat
    mana: int
    max_mana: int


class CardPlayed(_Event):
    type: Literal["card_played"] = "card_played"
    seat: Seat
    card: CardInstance
    cost: int
    target: Target | None


class CreatureSummoned(_Event):
    type: Literal["creature_summoned"] = "creature_summoned"
    creature: CreatureInstance
    lane: int
    slot: int


class CreatureMoved(_Event):
    type: Literal["creature_moved"] = "creature_moved"
    uid: str
    seat: Seat
    from_lane: int
    from_slot: int
    lane: int
    slot: int


class AttackMade(_Event):
    type: Literal["attack"] = "attack"
    uid: str
    target: AttackTarget


class CreatureDamaged(_Event):
    type: Literal["damage"] = "damage"
    uid: str
    amount: int
    hp: int


class CreatureHealed(_Event):
    type: Literal["heal"] = "heal"
    uid: str
    amount: int
    hp: int


class StatsChanged(_Event):
    type: Literal["stats_changed"] = "stats_changed"
    uid: str
    hp: int
    max_hp: int
    dmg: int


class CreatureDied(_Event):
    type: Literal["creature_died"] = "creature_died"
    uid: str
    seat: Seat
    lane: int
    slot: int


class SectionHpChanged(_Event):
    type: Literal["section_hp_changed"] = "section_hp_changed"
    seat: Seat
    lane: int
    # Negative for damage.
    delta: int
    hp: int
    max_hp: int


class SectionConquered(_Event):
    type: Literal["section_conquered"] = "section_conquered"
    seat: Seat
    lane: int


class PlayerReady(_Event):
    type: Literal["player_ready"] = "player_ready"
    seat: Seat


class GameOver(_Event):
    type: Literal["game_over"] = "game_over"
    # None is a draw.
    winner: Seat | None
    end_reason: EndReason


Event = Annotated[
    GameStarted
    | TurnStarted
    | PhaseChanged
    | CardDrawn
    | DeckEmpty
    | CardDiscarded
    | ManaChanged
    | CardPlayed
    | CreatureSummoned
    | CreatureMoved
    | AttackMade
    | CreatureDamaged
    | CreatureHealed
    | StatsChanged
    | CreatureDied
    | SectionHpChanged
    | SectionConquered
    | PlayerReady
    | GameOver,
    Field(discriminator="type"),
]


def events_for(events: Sequence[Event], seat: Seat) -> list[Event]:
    """The events as `seat` may see them: another player's drawn or discarded card (and so its
    uid) is removed."""
    visible: list[Event] = []
    for event in events:
        if isinstance(event, CardDrawn | CardDiscarded) and event.seat != seat:
            event = event.model_copy(update={"card": None})
        visible.append(event)
    return visible
