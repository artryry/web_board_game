from typing import Annotated

from pydantic import Field

from app.engine.context import EngineContext
from app.engine.registry import ModuleParams, PhaseModule, phase
from app.engine.seats import Seat


@phase("draw")
class Draw(PhaseModule):
    name = "Draw"
    description = (
        "The active player draws cards (during setup, both players do). A draw from an empty "
        "deck draws nothing, and a full hand still takes the card."
    )

    class Params(ModuleParams):
        count: Annotated[int, Field(ge=1, le=5)] = 1

    params: Params

    def run(self, ctx: EngineContext, seat: Seat) -> None:
        ctx.draw(seat, self.params.count)
