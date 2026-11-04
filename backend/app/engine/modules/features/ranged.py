from app.engine.registry import CostSpec, FeatureModule, feature


@feature("ranged")
class Ranged(FeatureModule):
    name = "Ranged"
    description = "Can also attack a neighbouring lane."
    cost_spec = CostSpec(base=2)
