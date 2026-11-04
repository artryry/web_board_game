from app.engine.registry import CostSpec, FeatureModule, feature


@feature("lifesteal_section")
class LifestealSection(FeatureModule):
    name = "Lifesteal"
    description = "Damage this creature deals heals your section in its lane."
    cost_spec = CostSpec(base=2)
