from app.engine.registry import PhaseModule, phase


@phase("discard_to_hand_limit")
class DiscardToHandLimit(PhaseModule):
    name = "Discard to hand limit"
    description = "The active player discards down to the ruleset's maximum hand size."
