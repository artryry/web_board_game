import uuid
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TimestampMixin


class Origin(TimestampMixin, Base):
    """A field type. System origins (`owner_id` NULL) are seeded templates readable by everyone."""

    __tablename__ = "origins"
    __table_args__ = (
        # A system origin has a system_key and no owner; a user's origin has an owner and no key.
        CheckConstraint("(owner_id IS NULL) = (system_key IS NOT NULL)", name="system_or_owned"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Stable name of a system origin (`neutral`, `forest`, ...), so code never needs its UUID.
    system_key: Mapped[str | None] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(40))
    color: Mapped[str] = mapped_column(String(32))
    icon: Mapped[str] = mapped_column(String(32))
    background_art_key: Mapped[str | None] = mapped_column(String(255))
    # [{key, params}], validated through the module registry before it is written.
    field_effects: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)

    @property
    def is_system(self) -> bool:
        return self.owner_id is None
