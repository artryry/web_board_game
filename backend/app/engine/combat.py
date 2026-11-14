"""Attacks, deaths and the end of the game (backend_plan §7.5)."""

from app.engine.actions import AttackTarget, CreatureRef
from app.engine.context import EngineContext
from app.engine.events import AttackMade, CreatureDied
from app.engine.registry import NO_CHANGE
from app.engine.seats import SEATS, Seat, other
from app.engine.state import CreatureInstance


def attack(ctx: EngineContext, attacker: CreatureInstance, target: AttackTarget) -> None:
    """Resolves one attack, deaths included. It uses the attacker's action."""
    ctx.step()
    attacker.exhausted = True
    ctx.emit(AttackMade(uid=attacker.uid, target=target))
    if isinstance(target, CreatureRef):
        # Both hit at the same time.
        defender = ctx.creature(target.uid)
        to_defender = ctx.damage_creature(defender, attacker.dmg)
        to_attacker = ctx.damage_creature(attacker, defender.dmg)
        _damage_dealt(ctx, attacker, to_defender)
        _damage_dealt(ctx, defender, to_attacker)
    else:
        section = ctx.section(target.seat, target.lane)
        penalty = NO_CHANGE
        for effect in ctx.field_effects(section.owner):
            penalty += effect.attacker_penalty()
        hit = max(0, attacker.dmg - penalty.dmg)
        ctx.damage_section(section, hit)
        ctx.damage_creature(attacker, penalty.hp, through_armor=False)
        _damage_dealt(ctx, attacker, hit)
    resolve_deaths(ctx)


def _damage_dealt(ctx: EngineContext, creature: CreatureInstance, amount: int) -> None:
    if amount <= 0:
        return
    for feature in ctx.features(creature):
        with ctx.trigger():
            feature.on_damage_dealt(ctx, creature, amount)


def resolve_deaths(ctx: EngineContext) -> None:
    """Removes every creature at 0 HP or less, then runs their death hooks. Deaths those cause
    resolve one level deeper, so a long chain hits the depth limit."""
    dead = [placed for placed in ctx.board() if placed.creature.hp <= 0]
    if not dead:
        return
    for section, slot, creature in dead:
        ctx.step()
        section.slots[slot] = None
        ctx.emit(CreatureDied(uid=creature.uid, seat=creature.owner, lane=section.lane, slot=slot))
    with ctx.trigger():
        for section, _, creature in dead:
            for feature in ctx.features(creature):
                feature.on_death(ctx, creature, section.lane)
        resolve_deaths(ctx)


def check_game_over(ctx: EngineContext) -> None:
    """Ends the game when a player has no section left (both at once is a draw), or when
    neither player has a card left and no creature is on the board (more sections left wins,
    the same number is a draw)."""
    if ctx.state.status == "finished":
        return
    beaten = [seat for seat in SEATS if all(section.conquered for section in ctx.sections(seat))]
    if beaten:
        ctx.end_game(other(beaten[0]) if len(beaten) == 1 else None, "conquered")
        return
    if _out_of_cards(ctx):
        left = [sum(not section.conquered for section in ctx.sections(seat)) for seat in SEATS]
        winner: Seat | None = None
        if left[0] != left[1]:
            winner = 0 if left[0] > left[1] else 1
        ctx.end_game(winner, "out_of_cards")


def _out_of_cards(ctx: EngineContext) -> bool:
    no_cards = all(not player.deck and not player.hand for player in ctx.state.players)
    return no_cards and not ctx.board()
