"""move enemy stat_bonus to attacker_penalty

Revision ID: 9c4e2a7d1b85
Revises: 055b2bf99518
Create Date: 2026-11-14 12:00:00.000000

`stat_bonus` with `applies_to: enemy` became its own field effect, `attacker_penalty` (M5): it
hits an enemy creature when it attacks a section, instead of lowering its stats. Stored origins
keep their `hp` and `dmg`.
"""

from collections.abc import Callable, Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "9c4e2a7d1b85"
down_revision: str | Sequence[str] | None = "055b2bf99518"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

Effects = list[dict[str, Any]]

_origins = sa.table(
    "origins",
    sa.column("id", sa.Uuid()),
    sa.column("field_effects", postgresql.JSONB()),
)


def _rewrite(match: Effects, convert: Callable[[Effects], Effects]) -> None:
    """Rewrites the field effects of every origin whose list contains `match`."""
    conn = op.get_bind()
    rows = conn.execute(
        sa.select(_origins.c.id, _origins.c.field_effects).where(
            _origins.c.field_effects.contains(match)
        )
    ).all()
    for origin_id, effects in rows:
        conn.execute(
            _origins.update()
            .where(_origins.c.id == origin_id)
            .values(field_effects=convert(effects))
        )


def _to_attacker_penalty(effects: Effects) -> Effects:
    converted = []
    for effect in effects:
        params = effect.get("params", {})
        if effect["key"] == "stat_bonus" and params.get("applies_to") == "enemy":
            effect = {
                "key": "attacker_penalty",
                "params": {"hp": params.get("hp", 0), "dmg": params.get("dmg", 0)},
            }
        converted.append(effect)
    return converted


def _to_enemy_stat_bonus(effects: Effects) -> Effects:
    # An origin can't repeat a key, so a penalty next to a stat_bonus can't go back: it's dropped.
    has_stat_bonus = any(effect["key"] == "stat_bonus" for effect in effects)
    converted = []
    for effect in effects:
        if effect["key"] == "attacker_penalty":
            if has_stat_bonus:
                continue
            params = effect.get("params", {})
            effect = {
                "key": "stat_bonus",
                "params": {
                    "applies_to": "enemy",
                    "hp": params.get("hp", 0),
                    "dmg": params.get("dmg", 0),
                },
            }
        converted.append(effect)
    return converted


def upgrade() -> None:
    _rewrite([{"key": "stat_bonus", "params": {"applies_to": "enemy"}}], _to_attacker_penalty)


def downgrade() -> None:
    _rewrite([{"key": "attacker_penalty"}], _to_enemy_stat_bonus)
