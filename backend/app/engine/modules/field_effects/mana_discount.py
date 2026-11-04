from typing import Annotated, Literal

from pydantic import Field

from app.engine.registry import FieldEffectModule, ModuleParams, field_effect


@field_effect("mana_discount")
class ManaDiscount(FieldEffectModule):
    name = "Mana discount"
    description = "Your cards of one kind cost less mana to play, never below 0."

    class Params(ModuleParams):
        card_kind: Literal["creature", "spell"] = "spell"
        amount: Annotated[int, Field(ge=1, le=2)] = 1
