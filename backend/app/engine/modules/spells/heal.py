from typing import Literal

from app.engine.registry import CostSpec, DmgUse, ModuleParams, SpellModule, spell


@spell("heal")
class Heal(SpellModule):
    name = "Heal"
    description = (
        "Heals one of your creatures or sections. The card's DMG is the amount, as a negative "
        "number."
    )
    dmg_use = DmgUse.HEAL
    cost_spec = CostSpec(base=1)

    class Params(ModuleParams):
        target: Literal["creature", "section"] = "creature"
