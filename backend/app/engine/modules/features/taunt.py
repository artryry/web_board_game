from app.engine.registry import CostSpec, FeatureModule, feature


@feature("taunt")
class Taunt(FeatureModule):
    name = "Taunt"
    description = "Enemies in this lane must attack this creature first."
    cost_spec = CostSpec(base=2)
