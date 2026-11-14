from app.engine.actions import CreatureToSlotRef, Target
from app.engine.context import EngineContext
from app.engine.registry import CostSpec, DmgUse, SpellModule, spell
from app.engine.seats import Seat, other
from app.engine.snapshots import CardSnapshot
from app.engine.targets import creatures, empty_slots, expect


@spell("move_enemy")
class MoveEnemy(SpellModule):
    name = "Move enemy"
    description = "Moves an enemy creature to another empty slot on its side."
    dmg_use = DmgUse.NONE
    cost_spec = CostSpec(base=2)

    def targets(self, ctx: EngineContext, caster: Seat) -> list[Target | None]:
        enemy = other(caster)
        slots = empty_slots(ctx, enemy)
        return [
            CreatureToSlotRef(uid=creature.uid, to=slot)
            for creature in creatures(ctx, enemy)
            for slot in slots
        ]

    def resolve(
        self, ctx: EngineContext, caster: Seat, card: CardSnapshot, target: Target | None
    ) -> None:
        ref = expect(target, CreatureToSlotRef)
        ctx.move_creature(ctx.creature(ref.uid), ref.to.lane, ref.to.slot)
