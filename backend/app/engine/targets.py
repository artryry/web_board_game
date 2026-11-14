"""Who and what can be targeted. Nothing here changes the state."""

from pydantic import BaseModel

from app.engine.actions import AttackTarget, CreatureRef, SectionRef, SlotRef
from app.engine.context import EngineContext
from app.engine.seats import Seat, other
from app.engine.state import CreatureInstance


def creatures(ctx: EngineContext, seat: Seat) -> list[CreatureInstance]:
    return [placed.creature for placed in ctx.board(seat)]


def empty_slots(ctx: EngineContext, seat: Seat) -> list[SlotRef]:
    return [
        SlotRef(seat=seat, lane=section.lane, slot=slot)
        for section in ctx.sections(seat)
        for slot, creature in enumerate(section.slots)
        if creature is None
    ]


def live_sections(ctx: EngineContext, seat: Seat) -> list[SectionRef]:
    """The seat's sections that aren't conquered."""
    return [
        SectionRef(seat=seat, lane=section.lane)
        for section in ctx.sections(seat)
        if not section.conquered
    ]


def attack_lanes(ctx: EngineContext, creature: CreatureInstance) -> list[int]:
    """Its own lane, plus any its features add (ranged), within the board."""
    lane = ctx.placed(creature).section.lane
    lanes = {lane}
    for feature in ctx.features(creature):
        lanes |= feature.attack_lanes(lane, ctx.lanes)
    return sorted(lane for lane in lanes if 0 <= lane < ctx.lanes)


def _lane_targets(ctx: EngineContext, enemy: Seat, lane: int) -> list[AttackTarget]:
    """A taunt creature if the section has one, else any of its creatures, else the section
    itself unless it is conquered."""
    section = ctx.section(enemy, lane)
    present = [creature for creature in section.slots if creature is not None]
    taunts = [
        creature
        for creature in present
        if any(feature.must_be_attacked_first() for feature in ctx.features(creature))
    ]
    defenders = taunts or present
    if defenders:
        return [CreatureRef(uid=creature.uid) for creature in defenders]
    if section.conquered:
        return []
    return [SectionRef(seat=enemy, lane=lane)]


def attack_targets(ctx: EngineContext, creature: CreatureInstance) -> list[AttackTarget]:
    enemy = other(creature.owner)
    return [
        target for lane in attack_lanes(ctx, creature) for target in _lane_targets(ctx, enemy, lane)
    ]


def lane_combat_target(ctx: EngineContext, creature: CreatureInstance) -> AttackTarget | None:
    """The target `lane_combat` picks: the first one in the creature's own lane, or, when that
    lane has nothing to hit, in its other attack lanes, lowest first."""
    own = ctx.placed(creature).section.lane
    enemy = other(creature.owner)
    for lane in sorted(attack_lanes(ctx, creature), key=lambda lane: (lane != own, lane)):
        targets = _lane_targets(ctx, enemy, lane)
        if targets:
            return targets[0]
    return None


def expect[T: BaseModel](target: object, kind: type[T]) -> T:
    """The target as the kind a spell needs. `legal_actions` only offers valid targets, so any
    other kind is a bug."""
    if not isinstance(target, kind):
        raise TypeError(f"Expected a {kind.__name__} target, got {target!r}")
    return target
