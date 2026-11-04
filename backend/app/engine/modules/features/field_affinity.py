from typing import Annotated

from pydantic import Field

from app.engine.registry import CostSpec, FeatureModule, ModuleParams, feature


@feature("field_affinity")
class FieldAffinity(FeatureModule):
    name = "Field affinity"
    description = "Gets extra DMG and HP while its section's field type matches its origin."
    cost_spec = CostSpec(per_param={"bonus": 1})

    class Params(ModuleParams):
        bonus: Annotated[int, Field(ge=1, le=2)] = 1
