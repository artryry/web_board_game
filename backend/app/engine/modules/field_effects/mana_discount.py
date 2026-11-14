from typing import Annotated, Literal

from pydantic import Field

from app.engine.registry import FieldEffectModule, ModuleParams, field_effect
from app.engine.snapshots import CardSnapshot


@field_effect("mana_discount")
class ManaDiscount(FieldEffectModule):
    name = "Mana discount"
    description = "Your cards of one kind cost less mana to play, never below 0."

    class Params(ModuleParams):
        card_kind: Literal["creature", "spell"] = "spell"
        amount: Annotated[int, Field(ge=1, le=2)] = 1

    params: Params

    def cost_change(self, card: CardSnapshot) -> int:
        return -self.params.amount if card.kind == self.params.card_kind else 0
