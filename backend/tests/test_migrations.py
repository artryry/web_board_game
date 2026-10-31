from alembic import command
from alembic.config import Config
from sqlalchemy.engine import URL


def test_migrations_downgrade_to_base_and_upgrade_to_head(
    alembic_cfg: Config, migrated_database: URL
) -> None:
    command.downgrade(alembic_cfg, "base")
    command.upgrade(alembic_cfg, "head")
