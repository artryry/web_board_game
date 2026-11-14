from typing import Annotated

from pydantic import Field

from app.engine.registry import FieldEffectModule, ModuleParams, StatDelta, field_effect


@field_effect("attacker_penalty")
class AttackerPenalty(FieldEffectModule):
    name = "Attacker penalty"
    description = (
        "An enemy creature that attacks one of your sections that isn't conquered loses HP "
        "(armor doesn't help) and deals less damage to it."
    )

    class Params(ModuleParams):
        hp: Annotated[int, Field(ge=0, le=2, title="HP")] = 0
        dmg: Annotated[int, Field(ge=0, le=2, title="DMG")] = 0

    params: Params

    def attacker_penalty(self) -> StatDelta:
        return StatDelta(hp=self.params.hp, dmg=self.params.dmg)
