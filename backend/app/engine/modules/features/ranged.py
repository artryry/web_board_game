from app.engine.registry import CostSpec, FeatureModule, feature


@feature("ranged")
class Ranged(FeatureModule):
    name = "Ranged"
    description = "Can also attack a neighbouring lane."
    cost_spec = CostSpec(base=2)

    def attack_lanes(self, lane: int, lanes: int) -> set[int]:
        return {neighbour for neighbour in (lane - 1, lane, lane + 1) if 0 <= neighbour < lanes}
