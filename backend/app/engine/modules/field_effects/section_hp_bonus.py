from typing import Annotated

from pydantic import Field

from app.engine.registry import FieldEffectModule, ModuleParams, field_effect


@field_effect("section_hp_bonus")
class SectionHpBonus(FieldEffectModule):
    name = "Section HP bonus"
    description = "Your sections start with extra HP."

    class Params(ModuleParams):
        amount: Annotated[int, Field(ge=1, le=10)] = 5
