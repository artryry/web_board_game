from typing import Annotated

from pydantic import Field

from app.engine.registry import CostSpec, FeatureModule, ModuleParams, StatDelta, feature
from app.engine.snapshots import OriginSnapshot
from app.engine.state import CreatureInstance


@feature("field_affinity")
class FieldAffinity(FeatureModule):
    name = "Field affinity"
    description = (
        "Gets extra DMG and HP while it stands in one of your sections that isn't conquered, "
        "if its origin is your deck's origin."
    )
    cost_spec = CostSpec(per_param={"bonus": 1})

    class Params(ModuleParams):
        bonus: Annotated[int, Field(ge=1, le=2)] = 1

    params: Params

    def field_bonus(self, creature: CreatureInstance, origin: OriginSnapshot) -> StatDelta:
        if creature.card.origin_id != origin.origin_id:
            return StatDelta()
        return StatDelta(hp=self.params.bonus, dmg=self.params.bonus)
