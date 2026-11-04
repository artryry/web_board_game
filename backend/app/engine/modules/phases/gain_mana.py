from app.engine.registry import PhaseModule, phase


@phase("gain_mana")
class GainMana(PhaseModule):
    name = "Gain mana"
    description = (
        "The active player's maximum mana grows by the ruleset's per-turn amount, up to the cap. "
        "Then their mana refills."
    )
