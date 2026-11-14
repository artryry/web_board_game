from app.engine.context import EngineContext
from app.engine.registry import PhaseModule, phase
from app.engine.seats import Seat


@phase("discard_to_hand_limit")
class DiscardToHandLimit(PhaseModule):
    name = "Discard to hand limit"
    description = (
        "The active player discards their newest cards down to the ruleset's maximum hand size. "
        "Without this phase, a hand has no limit."
    )

    def run(self, ctx: EngineContext, seat: Seat) -> None:
        limit = ctx.state.ruleset.hand.max_size
        while len(ctx.player(seat).hand) > limit:
            ctx.discard_newest(seat)
