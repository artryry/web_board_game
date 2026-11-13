from app.engine.registry import PhaseModule, phase


@phase("gain_mana")
class GainMana(PhaseModule):
    name = "Gain mana"
    description = (
        "Gives the active player their mana for the turn, as the ruleset's mana mode says: their "
        "maximum grows by the per-turn amount, up to the cap, and their mana refills (grow), or "
        "they get the per-turn amount back, up to the cap (restore)."
    )
