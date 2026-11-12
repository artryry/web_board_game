import uuid
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, SmallInteger, String, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, column_property, mapped_column

from app.core.db import Base
from app.models.mixins import TimestampMixin
from app.models.share_code import ShareCode

# The system ruleset everyone starts from.
DEFAULT_RULESET_KEY = "default"


class Ruleset(TimestampMixin, Base):
    """Turn-flow rules. System rulesets (`owner_id` NULL) are seeded and readable by everyone.

    Nothing protects a ruleset in use: a room copies its ruleset when it is created (M6).
    """

    __tablename__ = "rulesets"
    __table_args__ = (
        # A system ruleset has a system_key and no owner; a user's ruleset has an owner and no key.
        CheckConstraint("(owner_id IS NULL) = (system_key IS NOT NULL)", name="system_or_owned"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Stable name of a system ruleset (`default`), so code never needs its UUID.
    system_key: Mapped[str | None] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(40))
    # A RulesetDefinition, validated and normalized by rules_service before it is written.
    definition: Mapped[dict[str, Any]] = mapped_column(JSONB)
    # Copied from the definition, so rulesets of an old version can be found with SQL.
    schema_version: Mapped[int] = mapped_column(SmallInteger)

    # Loaded with the ruleset. A written ruleset needs a refresh before it is read.
    share_code: Mapped[str | None] = column_property(
        select(ShareCode.code)
        .where(ShareCode.ruleset_id == id)
        .correlate_except(ShareCode)
        .scalar_subquery()
    )

    @property
    def is_system(self) -> bool:
        return self.owner_id is None
