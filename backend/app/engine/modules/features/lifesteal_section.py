from app.engine.context import EngineContext
from app.engine.registry import CostSpec, FeatureModule, feature
from app.engine.state import CreatureInstance


@feature("lifesteal_section")
class LifestealSection(FeatureModule):
    name = "Lifesteal"
    description = (
        "Damage this creature deals, attacking or defending, heals your section in its lane."
    )
    cost_spec = CostSpec(base=2)

    def on_damage_dealt(self, ctx: EngineContext, creature: CreatureInstance, amount: int) -> None:
        ctx.heal_section(ctx.placed(creature).section, amount)
