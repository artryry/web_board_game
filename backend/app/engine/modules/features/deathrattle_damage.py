from typing import Annotated

from pydantic import Field

from app.engine.context import EngineContext
from app.engine.registry import CostSpec, FeatureModule, ModuleParams, feature
from app.engine.seats import other
from app.engine.state import CreatureInstance


@feature("deathrattle_damage")
class DeathrattleDamage(FeatureModule):
    name = "Deathrattle: damage"
    description = "When it dies, it deals damage to the enemy section in its lane."
    cost_spec = CostSpec(per_param={"amount": 1})

    class Params(ModuleParams):
        amount: Annotated[int, Field(ge=1, le=5)] = 1

    params: Params

    def on_death(self, ctx: EngineContext, creature: CreatureInstance, lane: int) -> None:
        ctx.damage_section(ctx.section(other(creature.owner), lane), self.params.amount)
