from typing import Annotated

from pydantic import Field

from app.engine.registry import ModuleParams, PhaseModule, phase


@phase("draw")
class Draw(PhaseModule):
    name = "Draw"
    description = "The active player draws cards. During setup, both players draw."

    class Params(ModuleParams):
        count: Annotated[int, Field(ge=1, le=5)] = 1
