"""seed default ruleset

Revision ID: 055b2bf99518
Revises: b4b30db144a1
Create Date: 2026-11-12 00:08:48.178157

"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "055b2bf99518"
down_revision: str | Sequence[str] | None = "b4b30db144a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Literal data, not imported from app code, so this migration keeps working as the code changes.
# tests/test_rulesets.py checks that it still equals RulesetDefinition() and still validates.
DEFAULT_DEFINITION = {
    "schema_version": 1,
    "board": {"lanes": 3, "slots_per_section": 3, "section_hp": 20},
    "deck": {"size": 30, "max_copies": 2, "allow_neutral": True},
    "mana": {"start": 1, "per_turn": 1, "max": 10},
    "hand": {"max_size": 10, "second_player_bonus_card": True},
    "setup": [{"key": "draw", "params": {"count": 3}}],
    "turn": [
        {"key": "gain_mana", "params": {}},
        {"key": "draw", "params": {"count": 1}},
        {
            "key": "action_phase",
            "params": {"actor": "active", "allow": ["play", "move", "attack"], "time_limit_s": 90},
        },
        {"key": "end_turn", "params": {}},
    ],
}


def upgrade() -> None:
    rulesets = sa.table(
        "rulesets",
        sa.column("id", sa.Uuid()),
        sa.column("system_key", sa.String()),
        sa.column("name", sa.String()),
        sa.column("definition", postgresql.JSONB()),
        sa.column("schema_version", sa.SmallInteger()),
    )
    op.bulk_insert(
        rulesets,
        [
            {
                "id": uuid.uuid4(),
                "system_key": "default",
                "name": "Default",
                "definition": DEFAULT_DEFINITION,
                "schema_version": 1,
            }
        ],
    )


def downgrade() -> None:
    op.execute("DELETE FROM rulesets WHERE system_key IS NOT NULL")
