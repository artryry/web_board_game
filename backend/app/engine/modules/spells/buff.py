from typing import Annotated

from pydantic import Field

from app.engine.registry import CostSpec, DmgUse, ModuleParams, SpellModule, spell


@spell("buff")
class Buff(SpellModule):
    name = "Buff"
    description = "Gives one of your creatures extra DMG and HP."
    dmg_use = DmgUse.NONE
    cost_spec = CostSpec(per_param={"dmg": 1, "hp": 1})

    class Params(ModuleParams):
        dmg: Annotated[int, Field(ge=0, le=5, title="DMG")] = 1
        hp: Annotated[int, Field(ge=0, le=5, title="HP")] = 1
