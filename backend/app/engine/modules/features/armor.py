from typing import Annotated

from pydantic import Field

from app.engine.registry import CostSpec, FeatureModule, ModuleParams, feature


@feature("armor")
class Armor(FeatureModule):
    name = "Armor"
    description = "Takes less damage from every hit."
    cost_spec = CostSpec(per_param={"amount": 1})

    class Params(ModuleParams):
        amount: Annotated[int, Field(ge=1, le=5)] = 1
