from app.engine.context import EngineContext
from app.engine.registry import PhaseModule, phase
from app.engine.seats import Seat


@phase("end_turn")
class EndTurn(PhaseModule):
    name = "End turn"
    description = "Ends the turn and passes it to the other player. It must be the last phase."

    def run(self, ctx: EngineContext, seat: Seat) -> None:
        ctx.end_turn()
