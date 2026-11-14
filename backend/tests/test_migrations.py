import asyncio
import json
import uuid
from typing import Any

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

# The revision before attacker_penalty replaced stat_bonus on `enemy`.
BEFORE_ATTACKER_PENALTY = "055b2bf99518"


def test_migrations_downgrade_to_base_and_upgrade_to_head(
    alembic_cfg: Config, migrated_database: URL
) -> None:
    command.downgrade(alembic_cfg, "base")
    command.upgrade(alembic_cfg, "head")


async def _run(url: URL, sql: str, **params: Any) -> list[Any]:
    engine = create_async_engine(url, poolclass=NullPool)
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(sql), params)
            return list(result.all()) if result.returns_rows else []
    finally:
        await engine.dispose()


def _insert_origin(url: URL, owner_id: uuid.UUID, effects: list[dict[str, Any]]) -> uuid.UUID:
    origin_id = uuid.uuid4()
    asyncio.run(
        _run(
            url,
            "INSERT INTO origins (id, owner_id, name, color, icon, field_effects) "
            "VALUES (:id, :owner_id, 'Thorns', 'grey', 'circle', CAST(:effects AS jsonb))",
            id=origin_id,
            owner_id=owner_id,
            effects=json.dumps(effects),
        )
    )
    return origin_id


def _effects(url: URL, origin_id: uuid.UUID) -> Any:
    rows = asyncio.run(_run(url, "SELECT field_effects FROM origins WHERE id = :id", id=origin_id))
    return rows[0][0]


def test_enemy_stat_bonus_moves_to_attacker_penalty(
    alembic_cfg: Config, migrated_database: URL
) -> None:
    url = migrated_database
    user_id = uuid.uuid4()
    enemy = {"key": "stat_bonus", "params": {"applies_to": "enemy", "hp": 1, "dmg": 2}}
    penalty = {"key": "attacker_penalty", "params": {"hp": 1, "dmg": 2}}
    free_move: dict[str, Any] = {"key": "free_move", "params": {}}
    own = {"key": "stat_bonus", "params": {"applies_to": "own_origin", "hp": 1, "dmg": 0}}

    command.downgrade(alembic_cfg, BEFORE_ATTACKER_PENALTY)
    try:
        asyncio.run(
            _run(
                url,
                "INSERT INTO users (id, username, email, password_hash) "
                "VALUES (:id, :name, :email, 'x')",
                id=user_id,
                name=f"mig_{user_id.hex[:8]}",
                email=f"mig_{user_id.hex[:8]}@example.com",
            )
        )
        thorny = _insert_origin(url, user_id, [enemy, free_move])
        forest = _insert_origin(url, user_id, [own])

        command.upgrade(alembic_cfg, "head")
        assert _effects(url, thorny) == [penalty, free_move]
        assert _effects(url, forest) == [own]

        # A penalty next to a stat_bonus can't become a second stat_bonus, so going back drops it.
        both = _insert_origin(url, user_id, [own, penalty])
        command.downgrade(alembic_cfg, BEFORE_ATTACKER_PENALTY)
        assert _effects(url, thorny) == [enemy, free_move]
        assert _effects(url, both) == [own]
    finally:
        command.upgrade(alembic_cfg, "head")
        asyncio.run(_run(url, "DELETE FROM users WHERE id = :id", id=user_id))
