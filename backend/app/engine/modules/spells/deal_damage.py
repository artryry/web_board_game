from typing import Literal

from app.engine.actions import CreatureRef, Target
from app.engine.context import EngineContext
from app.engine.registry import CostSpec, DmgUse, ModuleParams, SpellModule, spell
from app.engine.seats import Seat, other
from app.engine.snapshots import CardSnapshot
from app.engine.targets import creatures, expect


@spell("deal_damage")
class DealDamage(SpellModule):
    name = "Deal damage"
    description = "Deals the card's DMG to a creature. Armor applies."
    dmg_use = DmgUse.DAMAGE
    cost_spec = CostSpec(base=1)

    class Params(ModuleParams):
        target: Literal["enemy_creature", "any_creature"] = "enemy_creature"

    params: Params

    def targets(self, ctx: EngineContext, caster: Seat) -> list[Target | None]:
        enemies = creatures(ctx, other(caster))
        own = creatures(ctx, caster) if self.params.target == "any_creature" else []
        return [CreatureRef(uid=creature.uid) for creature in enemies + own]

    def resolve(
        self, ctx: EngineContext, caster: Seat, card: CardSnapshot, target: Target | None
    ) -> None:
        creature = ctx.creature(expect(target, CreatureRef).uid)
        ctx.damage_creature(creature, ctx.spell_damage(caster, card))
