from typing import Annotated

from pydantic import Field

from app.engine.registry import CostSpec, FeatureModule, ModuleParams, feature


@feature("deathrattle_damage")
class DeathrattleDamage(FeatureModule):
    name = "Deathrattle: damage"
    description = "When it dies, it deals damage to the enemy section in its lane."
    cost_spec = CostSpec(per_param={"amount": 1})

    class Params(ModuleParams):
        amount: Annotated[int, Field(ge=1, le=5)] = 1
