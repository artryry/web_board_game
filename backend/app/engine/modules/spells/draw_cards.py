from typing import Annotated

from pydantic import Field

from app.engine.actions import Target
from app.engine.context import EngineContext
from app.engine.registry import CostSpec, DmgUse, ModuleParams, SpellModule, spell
from app.engine.seats import Seat
from app.engine.snapshots import CardSnapshot


@spell("draw_cards")
class DrawCards(SpellModule):
    name = "Draw cards"
    description = "You draw cards."
    dmg_use = DmgUse.NONE
    cost_spec = CostSpec(per_param={"count": 2})

    class Params(ModuleParams):
        count: Annotated[int, Field(ge=1, le=3)] = 1

    params: Params

    def resolve(
        self, ctx: EngineContext, caster: Seat, card: CardSnapshot, target: Target | None
    ) -> None:
        ctx.draw(caster, self.params.count)
