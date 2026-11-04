from app.engine.registry import CostSpec, DmgUse, SpellModule, spell


@spell("damage_section")
class DamageSection(SpellModule):
    name = "Damage section"
    description = "Deals the card's DMG straight to an enemy section."
    dmg_use = DmgUse.DAMAGE
    cost_spec = CostSpec(base=2)
