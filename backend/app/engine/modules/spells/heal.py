from typing import Literal

from app.engine.actions import CreatureRef, SectionRef, Target
from app.engine.context import EngineContext
from app.engine.registry import CostSpec, DmgUse, ModuleParams, SpellModule, spell
from app.engine.seats import Seat
from app.engine.snapshots import CardSnapshot
from app.engine.targets import creatures, expect, live_sections


@spell("heal")
class Heal(SpellModule):
    name = "Heal"
    description = (
        "Heals one of your creatures, or one of your sections that isn't conquered. The card's "
        "DMG is the amount, as a negative number."
    )
    dmg_use = DmgUse.HEAL
    cost_spec = CostSpec(base=1)

    class Params(ModuleParams):
        target: Literal["creature", "section"] = "creature"

    params: Params

    def targets(self, ctx: EngineContext, caster: Seat) -> list[Target | None]:
        if self.params.target == "section":
            return list(live_sections(ctx, caster))
        return [CreatureRef(uid=creature.uid) for creature in creatures(ctx, caster)]

    def resolve(
        self, ctx: EngineContext, caster: Seat, card: CardSnapshot, target: Target | None
    ) -> None:
        amount = -(card.dmg or 0)
        if self.params.target == "section":
            ref = expect(target, SectionRef)
            ctx.heal_section(ctx.section(ref.seat, ref.lane), amount)
        else:
            ctx.heal_creature(ctx.creature(expect(target, CreatureRef).uid), amount)
