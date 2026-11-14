"""What one player may see of the game (backend_plan §7.9).

The opponent's hand and both decks are counts: a player never sees the order, or even the
contents, of a deck. The board, both players' mana and the phase are public.
"""

from pydantic import BaseModel

from app.engine.actions import ActionKind
from app.engine.context import EngineContext
from app.engine.registry import PhaseActor
from app.engine.seats import SEATS, Seat
from app.engine.snapshots import CardSnapshot, OriginSnapshot
from app.engine.state import EndReason, GameState, GameStatus, Pipeline, Section

# The order `allow` is listed in.
_KIND_ORDER: tuple[ActionKind, ...] = ("play", "move", "attack")


class HandCard(BaseModel):
    uid: str
    card: CardSnapshot
    # What it costs to play now, after the player's discounts.
    cost: int


class PlayerSummary(BaseModel):
    seat: Seat
    origin: OriginSnapshot
    mana: int
    max_mana: int
    deck_count: int
    hand_count: int
    # Only the viewer's own hand; None for the opponent.
    hand: list[HandCard] | None


class PhaseView(BaseModel):
    pipeline: Pipeline
    index: int
    key: str
    interactive: bool
    # For interactive phases only.
    actor: PhaseActor | None
    allow: list[ActionKind]
    time_limit_s: int | None


class PlayerView(BaseModel):
    seat: Seat
    version: int
    status: GameStatus
    winner: Seat | None
    end_reason: EndReason | None
    turn_number: int
    active_seat: Seat
    phase: PhaseView
    ready: list[bool]
    players: list[PlayerSummary]
    # sections[seat][lane], with the creatures in them.
    sections: list[list[Section]]


def view_for(state: GameState, seat: Seat) -> PlayerView:
    ctx = EngineContext(state)
    return PlayerView(
        seat=seat,
        version=state.version,
        status=state.status,
        winner=state.winner,
        end_reason=state.end_reason,
        turn_number=state.turn_number,
        active_seat=state.active_seat,
        phase=_phase_view(ctx),
        ready=list(state.ready),
        players=[_player_summary(ctx, owner, owner == seat) for owner in SEATS],
        sections=[[section.model_copy(deep=True) for section in row] for row in state.sections],
    )


def _phase_view(ctx: EngineContext) -> PhaseView:
    pointer = ctx.state.phase
    phase = ctx.current_phase()
    allowed = phase.allowed() if phase.interactive else frozenset()
    return PhaseView(
        pipeline=pointer.pipeline,
        index=pointer.index,
        key=ctx.current_phase_ref().key,
        interactive=phase.interactive,
        actor=phase.actor() if phase.interactive else None,
        allow=[kind for kind in _KIND_ORDER if kind in allowed],
        time_limit_s=phase.time_limit_s() if phase.interactive else None,
    )


def _player_summary(ctx: EngineContext, seat: Seat, own: bool) -> PlayerSummary:
    player = ctx.player(seat)
    hand = (
        [
            HandCard(uid=card.uid, card=card.card, cost=ctx.card_cost(seat, card.card))
            for card in player.hand
        ]
        if own
        else None
    )
    return PlayerSummary(
        seat=seat,
        origin=player.origin,
        mana=player.mana,
        max_mana=player.max_mana,
        deck_count=len(player.deck),
        hand_count=len(player.hand),
        hand=hand,
    )
