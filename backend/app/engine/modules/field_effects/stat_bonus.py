from typing import Annotated, Literal

from pydantic import Field

from app.engine.registry import FieldEffectModule, ModuleParams, field_effect


@field_effect("stat_bonus")
class StatBonus(FieldEffectModule):
    name = "Stat bonus"
    description = (
        "Changes creature stats: a bonus for your creatures of this origin (own_origin) or all "
        "your creatures (all_own), or a penalty for enemy creatures (enemy)."
    )

    class Params(ModuleParams):
        applies_to: Literal["own_origin", "all_own", "enemy"] = "own_origin"
        hp: Annotated[int, Field(ge=0, le=2, title="HP")] = 0
        dmg: Annotated[int, Field(ge=0, le=2, title="DMG")] = 0
