from app.engine.combat import attack, check_game_over
from app.engine.context import EngineContext
from app.engine.registry import PhaseModule, phase
from app.engine.seats import Seat
from app.engine.targets import lane_combat_target


@phase("lane_combat")
class LaneCombat(PhaseModule):
    name = "Lane combat"
    description = (
        "The active player's creatures that can still attack do so on their own, lane by lane: "
        "a taunt creature first, then the first creature, then the section. A ranged creature "
        "with nothing to hit in its own lane attacks a neighbouring one."
    )

    def run(self, ctx: EngineContext, seat: Seat) -> None:
        for section in ctx.sections(seat):
            for slot in range(len(section.slots)):
                # Read the slot now: an earlier attack may have emptied it.
                creature = section.slots[slot]
                if creature is None or creature.exhausted:
                    continue
                target = lane_combat_target(ctx, creature)
                if target is None:
                    continue
                attack(ctx, creature, target)
                check_game_over(ctx)
                if ctx.state.status == "finished":
                    return
