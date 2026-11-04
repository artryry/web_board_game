"""seed system origins

Revision ID: fb7c89ad1a33
Revises: 6f7ec82216a2
Create Date: 2026-11-01 00:56:55.602619

"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "fb7c89ad1a33"
down_revision: str | Sequence[str] | None = "6f7ec82216a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Literal data, not imported from app code, so this migration keeps working as the code changes.
# tests/test_origins.py checks that these field effects still validate against the registry.
SYSTEM_ORIGINS = [
    {
        "system_key": "neutral",
        "name": "Neutral",
        "color": "grey",
        "icon": "circle",
        "field_effects": [],
    },
    {
        "system_key": "forest",
        "name": "Forest",
        "color": "bluish_green",
        "icon": "leaf",
        "field_effects": [
            {"key": "stat_bonus", "params": {"applies_to": "own_origin", "hp": 1, "dmg": 0}}
        ],
    },
    {
        "system_key": "volcano",
        "name": "Volcano",
        "color": "vermillion",
        "icon": "flame",
        "field_effects": [
            {"key": "stat_bonus", "params": {"applies_to": "own_origin", "hp": 0, "dmg": 1}}
        ],
    },
    {
        "system_key": "ocean",
        "name": "Ocean",
        "color": "blue",
        "icon": "waves",
        "field_effects": [{"key": "free_move", "params": {}}],
    },
    {
        "system_key": "mountain",
        "name": "Mountain",
        "color": "orange",
        "icon": "mountain",
        "field_effects": [{"key": "section_hp_bonus", "params": {"amount": 5}}],
    },
]


def upgrade() -> None:
    origins = sa.table(
        "origins",
        sa.column("id", sa.Uuid()),
        sa.column("system_key", sa.String()),
        sa.column("name", sa.String()),
        sa.column("color", sa.String()),
        sa.column("icon", sa.String()),
        sa.column("field_effects", postgresql.JSONB()),
    )
    op.bulk_insert(origins, [{"id": uuid.uuid4(), **origin} for origin in SYSTEM_ORIGINS])


def downgrade() -> None:
    op.execute("DELETE FROM origins WHERE system_key IS NOT NULL")
