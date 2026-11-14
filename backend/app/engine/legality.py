"""Which actions a player may take now (backend_plan §7.4), and why another one is refused.

`legal_actions` lists every action with every valid target, one entry each, so the frontend
offers only those. `check_action` names the reason for a refusal, and then requires the action
to be in `legal_actions`, so the two can never disagree.
"""

from app.engine.actions import (
    Action,
    ActionKind,
    Attack,
    EndPhase,
    IllegalAction,
    Move,
    PlayCard,
    SlotRef,
    Surrender,
    Target,
)
from app.engine.context import EngineContext
from app.engine.registry import PhaseModule
from app.engine.seats import Seat
from app.engine.state import CardInstance, CreatureInstance, GameState
from app.engine.targets import attack_targets, creatures, empty_slots


def can_act(state: GameState, phase: PhaseModule, seat: Seat) -> bool:
    """Whether `seat` may act in the current phase (before looking at what it wants to do)."""
    if state.status != "playing" or not phase.interactive:
        return False
    if phase.actor() == "both":
        return not state.ready[seat]
    return seat == state.active_seat


def legal_actions(state: GameState, seat: Seat) -> list[Action]:
    if state.status != "playing":
        return []
    ctx = EngineContext(state)
    phase = ctx.current_phase()
    actions: list[Action] = []
    if can_act(state, phase, seat):
        allowed = phase.allowed()
        actions.append(EndPhase())
        if "play" in allowed:
            actions += _plays(ctx, seat)
        if "move" in allowed:
            actions += _moves(ctx, seat)
        if "attack" in allowed:
            actions += _attacks(ctx, seat)
    actions.append(Surrender())
    return actions


def _plays(ctx: EngineContext, seat: Seat) -> list[Action]:
    player = ctx.player(seat)
    plays: list[Action] = []
    for card in player.hand:
        if ctx.card_cost(seat, card.card) > player.mana:
            continue
        targets: list[Target | None]
        if card.card.kind == "creature":
            targets = list(empty_slots(ctx, seat))
        else:
            targets = ctx.spell(card.card).targets(ctx, seat)
        plays += [PlayCard(card_uid=card.uid, target=target) for target in targets]
    return plays


def _moves(ctx: EngineContext, seat: Seat) -> list[Action]:
    slots = empty_slots(ctx, seat)
    return [
        Move(creature_uid=creature.uid, to=slot)
        for creature in creatures(ctx, seat)
        if _can_move(ctx, seat, creature)
        for slot in slots
    ]


def _can_move(ctx: EngineContext, seat: Seat, creature: CreatureInstance) -> bool:
    # With free_move a creature only has to not have moved yet this turn.
    if creature.has_moved:
        return False
    return not (ctx.move_uses_action(seat) and creature.exhausted)


def _attacks(ctx: EngineContext, seat: Seat) -> list[Action]:
    return [
        Attack(creature_uid=creature.uid, target=target)
        for creature in creatures(ctx, seat)
        if not creature.exhausted
        for target in attack_targets(ctx, creature)
    ]


def check_action(state: GameState, seat: Seat, action: Action) -> None:
    """Raises `IllegalAction` with the reason, if `seat` can't take `action` now."""
    if state.status != "playing":
        raise IllegalAction("game_over", "The game is over")
    if isinstance(action, Surrender):
        return
    ctx = EngineContext(state)
    phase = ctx.current_phase()
    if not can_act(state, phase, seat):
        if phase.interactive and phase.actor() == "both":
            raise IllegalAction("not_allowed_now", "You have already ended this phase")
        raise IllegalAction("not_your_turn", "It isn't your turn")
    if isinstance(action, PlayCard):
        _check_play(ctx, phase, seat, action)
    elif isinstance(action, Move):
        _check_move(ctx, phase, seat, action)
    elif isinstance(action, Attack):
        _check_attack(ctx, phase, seat, action)
    if action not in legal_actions(state, seat):
        raise IllegalAction("invalid_target", "That target isn't allowed")


def _check_allowed(phase: PhaseModule, kind: ActionKind) -> None:
    if kind not in phase.allowed():
        raise IllegalAction("not_allowed_now", f"This phase doesn't allow '{kind}'")


def _check_play(ctx: EngineContext, phase: PhaseModule, seat: Seat, action: PlayCard) -> None:
    _check_allowed(phase, "play")
    player = ctx.player(seat)
    card = _card_in_hand(player.hand, action.card_uid)
    if ctx.card_cost(seat, card.card) > player.mana:
        raise IllegalAction("not_enough_mana", "Not enough mana")
    if card.card.kind == "creature":
        _check_slot(ctx, seat, action.target)


def _card_in_hand(hand: list[CardInstance], uid: str) -> CardInstance:
    card = next((card for card in hand if card.uid == uid), None)
    if card is None:
        raise IllegalAction("unknown_card", "That card isn't in your hand")
    return card


def _check_move(ctx: EngineContext, phase: PhaseModule, seat: Seat, action: Move) -> None:
    _check_allowed(phase, "move")
    creature = _own_creature(ctx, seat, action.creature_uid)
    if creature.has_moved:
        raise IllegalAction("already_moved", "That creature has already moved this turn")
    if ctx.move_uses_action(seat) and creature.exhausted:
        raise IllegalAction("creature_exhausted", "That creature can't act again this turn")
    _check_slot(ctx, seat, action.to)


def _check_attack(ctx: EngineContext, phase: PhaseModule, seat: Seat, action: Attack) -> None:
    _check_allowed(phase, "attack")
    creature = _own_creature(ctx, seat, action.creature_uid)
    if creature.exhausted:
        raise IllegalAction("creature_exhausted", "That creature can't act again this turn")


def _own_creature(ctx: EngineContext, seat: Seat, uid: str) -> CreatureInstance:
    placed = ctx.find(uid)
    if placed is None or placed.creature.owner != seat:
        raise IllegalAction("unknown_card", "That isn't one of your creatures")
    return placed.creature


def _check_slot(ctx: EngineContext, seat: Seat, target: Target | None) -> None:
    """A slot on the player's own side, which must be empty."""
    if (
        not isinstance(target, SlotRef)
        or target.seat != seat
        or not 0 <= target.lane < ctx.lanes
        or not 0 <= target.slot < len(ctx.section(seat, target.lane).slots)
    ):
        raise IllegalAction("invalid_target", "Pick a slot on your side of the board")
    if ctx.section(seat, target.lane).slots[target.slot] is not None:
        raise IllegalAction("slot_occupied", "That slot is taken")
