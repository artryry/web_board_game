from app.engine.actions import SectionRef, Target
from app.engine.context import EngineContext
from app.engine.registry import CostSpec, DmgUse, SpellModule, spell
from app.engine.seats import Seat, other
from app.engine.snapshots import CardSnapshot
from app.engine.targets import expect, live_sections


@spell("damage_section")
class DamageSection(SpellModule):
    name = "Damage section"
    description = "Deals the card's DMG straight to an enemy section that isn't conquered."
    dmg_use = DmgUse.DAMAGE
    cost_spec = CostSpec(base=2)

    def targets(self, ctx: EngineContext, caster: Seat) -> list[Target | None]:
        return list(live_sections(ctx, other(caster)))

    def resolve(
        self, ctx: EngineContext, caster: Seat, card: CardSnapshot, target: Target | None
    ) -> None:
        ref = expect(target, SectionRef)
        ctx.damage_section(ctx.section(ref.seat, ref.lane), ctx.spell_damage(caster, card))
