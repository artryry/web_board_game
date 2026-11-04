from typing import Annotated

from pydantic import Field

from app.engine.registry import FieldEffectModule, ModuleParams, field_effect


@field_effect("turn_start_heal_section")
class TurnStartHealSection(FieldEffectModule):
    name = "Regeneration"
    description = "At the start of your turn, each of your sections that isn't conquered heals."

    class Params(ModuleParams):
        amount: Annotated[int, Field(ge=1, le=3)] = 1
