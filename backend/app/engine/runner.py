"""The engine's entry points (backend_plan §7.3): start a game, list and apply actions, show a
player their view, and replay a game from its seed and actions.

The runner walks the ruleset's pipelines. An automatic phase runs at once; an interactive one
stops the runner until the players end it. M6 imports from here: `app.engine` itself stays
empty, because `app.schemas.rules` imports the registry and the engine imports that schema.
"""

from collections.abc import Sequence

from app.engine.actions import (
    Action,
    Attack,
    EndPhase,
    IllegalAction,
    Move,
    PlayCard,
    SlotRef,
    Surrender,
)
from app.engine.combat import attack, check_game_over, resolve_deaths
from app.engine.context import EngineContext, EngineLimitError
from app.engine.events import (
    CardPlayed,
    Event,
    GameStarted,
    PhaseChanged,
    PlayerReady,
    TurnStarted,
    events_for,
)
from app.engine.legality import check_action, legal_actions
from app.engine.registry import (
    FeatureModule,
    FieldEffectModule,
    PhaseModule,
    SpellModule,
    registry,
)
from app.engine.rng import Rng
from app.engine.seats import SEATS, Seat, other
from app.engine.snapshots import DeckSnapshot
from app.engine.state import (
    CardInstance,
    GameState,
    LoggedAction,
    PhasePointer,
    PlayerState,
    Section,
)
from app.engine.targets import expect
from app.engine.views import PlayerView, view_for
from app.schemas.rules import RulesetDefinition

__all__ = [
    "PlayerView",
    "apply_action",
    "events_for",
    "legal_actions",
    "replay",
    "start_game",
    "view_for",
]


def start_game(
    ruleset: RulesetDefinition, decks: tuple[DeckSnapshot, DeckSnapshot], seed: int
) -> tuple[GameState, list[Event]]:
    """Shuffles both decks, builds the board, runs Setup, gives seat 1 its bonus card, and
    starts seat 0's first turn. M6 has already checked the ruleset and the decks."""
    _build_every_module(ruleset, decks)
    rng = Rng(seed)
    players = [_player(seat, deck, rng) for seat, deck in zip(SEATS, decks, strict=True)]
    state = GameState(
        ruleset=ruleset.model_copy(deep=True),
        seed=seed,
        rng_state=rng.state,
        phase=PhasePointer(pipeline="setup", index=0),
        players=players,
        sections=[_sections(ruleset, seat) for seat in SEATS],
    )
    ctx = EngineContext(state)
    ctx.emit(GameStarted())
    for seat in SEATS:
        for effect in ctx.field_effects(seat):
            effect.on_game_start(ctx, seat)
    _run_setup(ctx)
    if state.status == "playing" and ruleset.hand.second_player_bonus_card:
        ctx.draw(1, 1)
        check_game_over(ctx)
    if state.status == "playing":
        _start_turn(ctx, 0)
        _advance(ctx)
    return state, ctx.events


def apply_action(state: GameState, seat: Seat, action: Action) -> tuple[GameState, list[Event]]:
    """Applies `seat`'s action to a copy of the state and returns the copy with what happened.

    Raises `IllegalAction` if the action isn't allowed now, or if it would go past the engine's
    limits; `state` itself never changes.
    """
    check_action(state, seat, action)
    new_state = state.clone()
    ctx = EngineContext(new_state)
    try:
        _resolve(ctx, seat, action)
    except EngineLimitError as exc:
        raise IllegalAction("engine_limit", str(exc)) from None
    new_state.version += 1
    new_state.log.append(LoggedAction(seat=seat, action=action))
    return new_state, ctx.events


def replay(
    ruleset: RulesetDefinition,
    decks: tuple[DeckSnapshot, DeckSnapshot],
    seed: int,
    log: Sequence[LoggedAction],
) -> list[GameState]:
    """Every state of a game: after the start, then after each action."""
    state, _ = start_game(ruleset, decks, seed)
    states = [state]
    for entry in log:
        state, _ = apply_action(state, entry.seat, entry.action)
        states.append(state)
    return states


def _build_every_module(ruleset: RulesetDefinition, decks: Sequence[DeckSnapshot]) -> None:
    """Parses every module reference once, so a bad one fails before the game starts."""
    for ref in [*ruleset.setup, *ruleset.turn]:
        registry.build(PhaseModule, ref)
    for deck in decks:
        for ref in deck.origin.field_effects:
            registry.build(FieldEffectModule, ref)
        for card in deck.cards:
            base = FeatureModule if card.kind == "creature" else SpellModule
            for ref in card.abilities:
                registry.build(base, ref)


def _player(seat: Seat, deck: DeckSnapshot, rng: Rng) -> PlayerState:
    cards = list(deck.cards)
    rng.shuffle(cards)
    # Uids follow the shuffled order, so a uid says nothing about which card it is.
    instances = [
        CardInstance(uid=f"p{seat}-{number}", card=card) for number, card in enumerate(cards, 1)
    ]
    return PlayerState(origin=deck.origin, deck=instances)


def _sections(ruleset: RulesetDefinition, seat: Seat) -> list[Section]:
    board = ruleset.board
    return [
        Section(
            owner=seat,
            lane=lane,
            hp=board.section_hp,
            max_hp=board.section_hp,
            slots=[None] * board.slots_per_section,
        )
        for lane in range(board.lanes)
    ]


def _run_setup(ctx: EngineContext) -> None:
    """Runs each Setup phase for seat 0, then seat 1."""
    state = ctx.state
    for index, ref in enumerate(state.ruleset.setup):
        state.phase = PhasePointer(pipeline="setup", index=index)
        phase = ctx.current_phase()
        ctx.emit(PhaseChanged(pipeline="setup", index=index, key=ref.key))
        for seat in SEATS:
            _run_automatic(ctx, phase, seat)
            if state.status == "finished":
                return


def _run_automatic(ctx: EngineContext, phase: PhaseModule, seat: Seat) -> None:
    ctx.step()
    phase.run(ctx, seat)
    resolve_deaths(ctx)
    check_game_over(ctx)


def _start_turn(ctx: EngineContext, seat: Seat) -> None:
    """Every creature on the board, either player's, gets its action back; then the new active
    player's turn-start effects run."""
    state = ctx.state
    state.turn_number += 1
    state.active_seat = seat
    ctx.emit(TurnStarted(seat=seat, turn_number=state.turn_number))
    for placed in ctx.board():
        placed.creature.exhausted = False
        placed.creature.has_moved = False
    for effect in ctx.field_effects(seat):
        with ctx.trigger():
            effect.on_turn_start(ctx, seat)
    state.phase = PhasePointer(pipeline="turn", index=0)


def _advance(ctx: EngineContext) -> None:
    """Runs the turn pipeline from the current phase until an interactive phase or the end of
    the game. The rules end every turn with end_turn, which starts the other seat's turn."""
    state = ctx.state
    while state.status == "playing":
        phase = ctx.current_phase()
        key = ctx.current_phase_ref().key
        ctx.emit(PhaseChanged(pipeline="turn", index=state.phase.index, key=key))
        if phase.interactive:
            state.ready = [False, False]
            return
        _run_automatic(ctx, phase, state.active_seat)
        if ctx.turn_ended:
            ctx.turn_ended = False
            if state.status == "playing":
                _start_turn(ctx, other(state.active_seat))
        else:
            state.phase.index += 1


def _resolve(ctx: EngineContext, seat: Seat, action: Action) -> None:
    if isinstance(action, Surrender):
        ctx.end_game(other(seat), "surrender")
        return
    if isinstance(action, EndPhase):
        _end_phase(ctx, seat)
        return
    if isinstance(action, PlayCard):
        _play(ctx, seat, action)
    elif isinstance(action, Move):
        _move(ctx, seat, action)
    elif isinstance(action, Attack):
        attack(ctx, ctx.creature(action.creature_uid), action.target)
    resolve_deaths(ctx)
    check_game_over(ctx)


def _end_phase(ctx: EngineContext, seat: Seat) -> None:
    """Ends the interactive phase; in an `actor: both` phase, only once both players are
    ready."""
    state = ctx.state
    if ctx.current_phase().actor() == "both":
        state.ready[seat] = True
        ctx.emit(PlayerReady(seat=seat))
        if not all(state.ready):
            return
    state.phase.index += 1
    _advance(ctx)


def _play(ctx: EngineContext, seat: Seat, action: PlayCard) -> None:
    card = ctx.take_from_hand(seat, action.card_uid)
    cost = ctx.card_cost(seat, card.card)
    ctx.spend_mana(seat, cost)
    ctx.emit(CardPlayed(seat=seat, card=card, cost=cost, target=action.target))
    if card.card.kind == "creature":
        slot = expect(action.target, SlotRef)
        features = list(card.card.abilities)
        ctx.summon(seat, slot.lane, slot.slot, card.card, uid=card.uid, features=features)
        return
    with ctx.trigger():
        ctx.spell(card.card).resolve(ctx, seat, card.card, action.target)


def _move(ctx: EngineContext, seat: Seat, action: Move) -> None:
    creature = ctx.creature(action.creature_uid)
    creature.has_moved = True
    if ctx.move_uses_action(seat):
        creature.exhausted = True
    ctx.move_creature(creature, action.to.lane, action.to.slot)
