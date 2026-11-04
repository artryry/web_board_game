from app.engine.registry import CostSpec, FeatureModule, feature


@feature("charge")
class Charge(FeatureModule):
    name = "Charge"
    description = "Can attack on the turn it is played."
    cost_spec = CostSpec(base=2)
