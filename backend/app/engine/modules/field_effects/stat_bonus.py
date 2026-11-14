from typing import Annotated, Literal

from pydantic import Field

from app.engine.registry import FieldEffectModule, ModuleParams, StatDelta, field_effect
from app.engine.snapshots import OriginSnapshot
from app.engine.state import CreatureInstance


@field_effect("stat_bonus")
class StatBonus(FieldEffectModule):
    name = "Stat bonus"
    description = (
        "Your creatures of this origin (own_origin) or all your creatures (all_own) get extra HP "
        "and DMG while they stand in one of your sections that isn't conquered."
    )

    class Params(ModuleParams):
        applies_to: Literal["own_origin", "all_own"] = "own_origin"
        hp: Annotated[int, Field(ge=0, le=2, title="HP")] = 0
        dmg: Annotated[int, Field(ge=0, le=2, title="DMG")] = 0

    params: Params

    def field_bonus(self, creature: CreatureInstance, origin: OriginSnapshot) -> StatDelta:
        if self.params.applies_to == "own_origin" and creature.card.origin_id != origin.origin_id:
            return StatDelta()
        return StatDelta(hp=self.params.hp, dmg=self.params.dmg)
