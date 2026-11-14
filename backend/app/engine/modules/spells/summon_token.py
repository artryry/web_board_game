from typing import Annotated

from pydantic import Field

from app.engine.actions import SlotRef, Target
from app.engine.context import EngineContext
from app.engine.registry import CostSpec, DmgUse, ModuleParams, SpellModule, spell
from app.engine.seats import Seat
from app.engine.snapshots import CardSnapshot
from app.engine.targets import empty_slots, expect


@spell("summon_token")
class SummonToken(SpellModule):
    name = "Summon token"
    description = (
        "Summons a token creature into an empty slot on your side. Like any creature, it can't "
        "attack on the turn it arrives."
    )
    dmg_use = DmgUse.NONE
    cost_spec = CostSpec(per_param={"hp": 1, "dmg": 1})

    class Params(ModuleParams):
        hp: Annotated[int, Field(ge=1, le=5, title="HP")] = 1
        dmg: Annotated[int, Field(ge=0, le=5, title="DMG")] = 1

    params: Params

    def targets(self, ctx: EngineContext, caster: Seat) -> list[Target | None]:
        return list(empty_slots(ctx, caster))

    def resolve(
        self, ctx: EngineContext, caster: Seat, card: CardSnapshot, target: Target | None
    ) -> None:
        slot = expect(target, SlotRef)
        # The token looks like the spell that made it, and belongs to the caster's origin.
        token = CardSnapshot(
            card_id=card.card_id,
            name=card.name,
            kind="creature",
            origin_id=ctx.player(caster).origin.origin_id,
            mana_cost=0,
            hp=self.params.hp,
            dmg=self.params.dmg,
            art_url=card.art_url,
        )
        ctx.summon(caster, slot.lane, slot.slot, token, uid=ctx.new_token_uid(), features=[])
