from typing import Literal

from app.engine.registry import CostSpec, DmgUse, ModuleParams, SpellModule, spell


@spell("deal_damage")
class DealDamage(SpellModule):
    name = "Deal damage"
    description = "Deals the card's DMG to a creature."
    dmg_use = DmgUse.DAMAGE
    cost_spec = CostSpec(base=1)

    class Params(ModuleParams):
        target: Literal["enemy_creature", "any_creature"] = "enemy_creature"
