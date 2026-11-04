from typing import Annotated

from pydantic import Field

from app.engine.registry import CostSpec, DmgUse, ModuleParams, SpellModule, spell


@spell("draw_cards")
class DrawCards(SpellModule):
    name = "Draw cards"
    description = "You draw cards."
    dmg_use = DmgUse.NONE
    cost_spec = CostSpec(per_param={"count": 2})

    class Params(ModuleParams):
        count: Annotated[int, Field(ge=1, le=3)] = 1
