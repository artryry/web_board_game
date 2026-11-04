from app.engine.registry import CostSpec, DmgUse, SpellModule, spell


@spell("move_enemy")
class MoveEnemy(SpellModule):
    name = "Move enemy"
    description = "Moves an enemy creature to another empty slot on its side."
    dmg_use = DmgUse.NONE
    cost_spec = CostSpec(base=2)
