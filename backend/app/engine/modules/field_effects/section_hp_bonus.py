from typing import Annotated

from pydantic import Field

from app.engine.context import EngineContext
from app.engine.registry import FieldEffectModule, ModuleParams, field_effect
from app.engine.seats import Seat


@field_effect("section_hp_bonus")
class SectionHpBonus(FieldEffectModule):
    name = "Section HP bonus"
    description = "Your sections start with extra HP."

    class Params(ModuleParams):
        amount: Annotated[int, Field(ge=1, le=10)] = 5

    params: Params

    def on_game_start(self, ctx: EngineContext, owner: Seat) -> None:
        for section in ctx.sections(owner):
            ctx.raise_section_max_hp(section, self.params.amount)
