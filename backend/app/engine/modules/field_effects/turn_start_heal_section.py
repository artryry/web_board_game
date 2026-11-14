from typing import Annotated

from pydantic import Field

from app.engine.context import EngineContext
from app.engine.registry import FieldEffectModule, ModuleParams, field_effect
from app.engine.seats import Seat


@field_effect("turn_start_heal_section")
class TurnStartHealSection(FieldEffectModule):
    name = "Regeneration"
    description = "At the start of your turn, each of your sections that isn't conquered heals."

    class Params(ModuleParams):
        amount: Annotated[int, Field(ge=1, le=3)] = 1

    params: Params

    def on_turn_start(self, ctx: EngineContext, owner: Seat) -> None:
        for section in ctx.sections(owner):
            ctx.heal_section(section, self.params.amount)
