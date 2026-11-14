from app.engine.context import EngineContext
from app.engine.registry import PhaseModule, phase
from app.engine.seats import Seat


@phase("gain_mana")
class GainMana(PhaseModule):
    name = "Gain mana"
    description = (
        "Gives the active player their mana for the turn, as the ruleset's mana mode says: their "
        "maximum grows by the per-turn amount, up to the cap, and their mana refills (grow), or "
        "they get the per-turn amount back, up to the cap (restore)."
    )

    def run(self, ctx: EngineContext, seat: Seat) -> None:
        rules = ctx.state.ruleset.mana
        player = ctx.player(seat)
        if not player.mana_started:
            # A player's first Gain mana gives the starting mana (backend_plan §7.3).
            ctx.set_mana(seat, rules.start, rules.start if rules.mode == "grow" else rules.max)
        elif rules.mode == "grow":
            max_mana = min(rules.max, player.max_mana + rules.per_turn)
            ctx.set_mana(seat, max_mana, max_mana)
        else:
            ctx.set_mana(seat, min(rules.max, player.mana + rules.per_turn), rules.max)
