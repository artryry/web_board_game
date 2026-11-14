"""Snapshots, decks, rulesets and game setups for engine tests, plus a simple bot."""

from collections.abc import Sequence
from typing import Any

from app.engine.actions import Action, Attack, EndPhase, Move, PlayCard, SectionRef
from app.engine.context import EngineContext
from app.engine.events import Event
from app.engine.legality import legal_actions
from app.engine.registry import ModuleRef
from app.engine.runner import apply_action, start_game
from app.engine.seats import Seat, other
from app.engine.snapshots import CardSnapshot, DeckSnapshot, OriginSnapshot
from app.engine.state import CardInstance, CreatureInstance, GameState, LoggedAction
from app.schemas.rules import RulesetDefinition

FOREST = "forest"
NEUTRAL = "neutral"


def ref(key: str, **params: Any) -> ModuleRef:
    return ModuleRef(key=key, params=params)


def origin(origin_id: str = FOREST, *effects: ModuleRef) -> OriginSnapshot:
    return OriginSnapshot(
        origin_id=origin_id,
        name=origin_id.title(),
        color="grey",
        icon="circle",
        field_effects=list(effects),
    )


def creature(
    name: str = "Wolf",
    hp: int = 2,
    dmg: int = 1,
    cost: int = 1,
    *features: ModuleRef,
    origin_id: str = FOREST,
) -> CardSnapshot:
    return CardSnapshot(
        card_id=f"card-{name.lower()}",
        name=name,
        kind="creature",
        origin_id=origin_id,
        mana_cost=cost,
        hp=hp,
        dmg=dmg,
        abilities=list(features),
    )


def spell(
    key: str,
    dmg: int | None = None,
    cost: int = 1,
    origin_id: str = FOREST,
    params: dict[str, Any] | None = None,
    **more_params: Any,
) -> CardSnapshot:
    """A spell card. `dmg` is the card's DMG; the effect's params come as keywords, or in
    `params` for effects whose params are also named `dmg` (buff, summon_token)."""
    params = {**(params or {}), **more_params}
    return CardSnapshot(
        card_id=f"card-{key}",
        name=key.replace("_", " ").title(),
        kind="spell",
        origin_id=origin_id,
        mana_cost=cost,
        dmg=dmg,
        abilities=[ref(key, **params)],
    )


def deck(
    deck_origin: OriginSnapshot, cards: Sequence[CardSnapshot], copies: int = 1
) -> DeckSnapshot:
    return DeckSnapshot(origin=deck_origin, cards=[card for card in cards for _ in range(copies)])


def rules(**sections: Any) -> RulesetDefinition:
    """The default ruleset with some sections changed: a dict updates a section, a list
    replaces a pipeline (`setup=[ref("draw", count=1)]`)."""
    data = RulesetDefinition().model_dump()
    for name, value in sections.items():
        if isinstance(value, dict):
            data[name].update(value)
        else:
            data[name] = [
                item.model_dump() if isinstance(item, ModuleRef) else item for item in value
            ]
    return RulesetDefinition.model_validate(data)


def bare_rules(**sections: Any) -> RulesetDefinition:
    """Rules for unit tests: no Setup draws, no bonus card, and a turn of Gain mana, Action
    phase, End turn, so hands start empty and the test sets the board up itself."""
    base: dict[str, Any] = {
        "setup": [],
        "hand": {"second_player_bonus_card": False},
        "turn": [ref("gain_mana"), ref("action_phase"), ref("end_turn")],
    }
    base.update(sections)
    return rules(**base)


def new_game(
    ruleset: RulesetDefinition | None = None,
    decks: tuple[DeckSnapshot, DeckSnapshot] | None = None,
    seed: int = 1,
) -> GameState:
    state, _ = start_game(ruleset or bare_rules(), decks or filler_decks(), seed)
    return state


def filler_decks(
    origin0: OriginSnapshot | None = None, origin1: OriginSnapshot | None = None
) -> tuple[DeckSnapshot, DeckSnapshot]:
    """Decks of five plain cards each. With `bare_rules` they stay in the decks, and keep the
    game from ending as out of cards."""
    filler = creature("Filler", 1, 1, 9)
    return deck(origin0 or origin(), [filler], 5), deck(origin1 or origin("volcano"), [filler], 5)


def pass_turn(state: GameState) -> GameState:
    """The active player ends their action phase (and so, in bare rules, their turn)."""
    state, _ = apply_action(state, state.active_seat, EndPhase())
    return state


def put_creature(
    state: GameState, seat: Seat, lane: int, slot: int, card: CardSnapshot, *, ready: bool = True
) -> CreatureInstance:
    """Places a creature straight on the board, field bonus included, for a test setup."""
    ctx = EngineContext(state)
    placed = ctx.summon(
        seat, lane, slot, card, uid=ctx.new_token_uid(), features=list(card.abilities)
    )
    placed.exhausted = not ready
    return placed


def give_card(state: GameState, seat: Seat, card: CardSnapshot) -> str:
    """Puts a card into a player's hand and returns its uid."""
    uid = f"h{state.next_uid}"
    state.next_uid += 1
    state.players[seat].hand.append(CardInstance(uid=uid, card=card))
    return uid


def set_mana(state: GameState, seat: Seat, mana: int) -> None:
    state.players[seat].mana = mana
    state.players[seat].max_mana = max(mana, state.players[seat].max_mana)


def creature_at(state: GameState, seat: Seat, lane: int, slot: int) -> CreatureInstance:
    found = state.sections[seat][lane].slots[slot]
    assert found is not None, f"no creature at seat {seat}, lane {lane}, slot {slot}"
    return found


def act(state: GameState, seat: Seat, action: Action) -> tuple[GameState, list[Event]]:
    return apply_action(state, seat, action)


def acting_seat(state: GameState) -> Seat | None:
    """Who should act next: the active seat if it can, else the other one (in `actor: both`)."""
    for seat in (state.active_seat, other(state.active_seat)):
        if EndPhase() in legal_actions(state, seat):
            return seat
    return None


def greedy_action(state: GameState, seat: Seat) -> Action:
    """Plays the first card it can, then attacks (sections first), then moves a creature out
    of a lane where nothing is left to hit, then ends the phase."""
    actions = legal_actions(state, seat)
    plays = [action for action in actions if isinstance(action, PlayCard)]
    if plays:
        return plays[0]
    attacks = [action for action in actions if isinstance(action, Attack)]
    at_sections = [action for action in attacks if isinstance(action.target, SectionRef)]
    if at_sections:
        return at_sections[0]
    if attacks:
        return attacks[0]
    for action in actions:
        if isinstance(action, Move) and _stuck(state, seat, action):
            return action
    return EndPhase()


def _stuck(state: GameState, seat: Seat, move: Move) -> bool:
    """The creature's lane has nothing to hit, and the move takes it to a lane that has."""
    enemy = state.sections[other(seat)]
    lane = next(
        section.lane
        for section in state.sections[seat]
        if any(c is not None and c.uid == move.creature_uid for c in section.slots)
    )

    def has_target(lane: int) -> bool:
        section = enemy[lane]
        return not section.conquered or any(c is not None for c in section.slots)

    return not has_target(lane) and has_target(move.to.lane)


def play_out(state: GameState, max_actions: int = 3000) -> tuple[GameState, list[LoggedAction]]:
    """Plays the game with the greedy bot on both sides until it ends."""
    for _ in range(max_actions):
        seat = acting_seat(state)
        if seat is None:
            break
        state, _ = apply_action(state, seat, greedy_action(state, seat))
    return state, list(state.log)
