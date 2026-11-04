from typing import Annotated

from pydantic import Field

from app.engine.registry import CostSpec, DmgUse, ModuleParams, SpellModule, spell


@spell("summon_token")
class SummonToken(SpellModule):
    name = "Summon token"
    description = "Summons a token creature into an empty slot on your side."
    dmg_use = DmgUse.NONE
    cost_spec = CostSpec(per_param={"hp": 1, "dmg": 1})

    class Params(ModuleParams):
        hp: Annotated[int, Field(ge=1, le=5, title="HP")] = 1
        dmg: Annotated[int, Field(ge=0, le=5, title="DMG")] = 1
