from typing import Annotated

from pydantic import Field

from app.engine.registry import FieldEffectModule, ModuleParams, field_effect


@field_effect("spell_power")
class SpellPower(FieldEffectModule):
    name = "Spell power"
    description = "Your damage spells deal extra damage."

    class Params(ModuleParams):
        amount: Annotated[int, Field(ge=1, le=2)] = 1
