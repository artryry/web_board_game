from typing import Annotated

from pydantic import Field

from app.engine.actions import CreatureRef, Target
from app.engine.context import EngineContext
from app.engine.registry import CostSpec, DmgUse, ModuleParams, SpellModule, spell
from app.engine.seats import Seat
from app.engine.snapshots import CardSnapshot
from app.engine.targets import creatures, expect


@spell("buff")
class Buff(SpellModule):
    name = "Buff"
    description = "Gives one of your creatures extra DMG and HP (its maximum HP too)."
    dmg_use = DmgUse.NONE
    cost_spec = CostSpec(per_param={"dmg": 1, "hp": 1})

    class Params(ModuleParams):
        dmg: Annotated[int, Field(ge=0, le=5, title="DMG")] = 1
        hp: Annotated[int, Field(ge=0, le=5, title="HP")] = 1

    params: Params

    def targets(self, ctx: EngineContext, caster: Seat) -> list[Target | None]:
        return [CreatureRef(uid=creature.uid) for creature in creatures(ctx, caster)]

    def resolve(
        self, ctx: EngineContext, caster: Seat, card: CardSnapshot, target: Target | None
    ) -> None:
        creature = ctx.creature(expect(target, CreatureRef).uid)
        ctx.buff(creature, hp=self.params.hp, dmg=self.params.dmg)
