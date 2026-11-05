import uuid
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, Index, SmallInteger, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import OwnedMixin, TimestampMixin


class Card(OwnedMixin, TimestampMixin, Base):
    __tablename__ = "cards"
    __table_args__ = (
        CheckConstraint("kind IN ('creature', 'spell')", name="kind"),
        # Covers "my cards" and "my cards of this origin" (also the origin-in-use check).
        Index("ix_cards_owner_id_origin_id", "owner_id", "origin_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(40))
    # RESTRICT: the origin service answers with 409 origin_in_use before this is ever hit.
    origin_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("origins.id", ondelete="RESTRICT"))
    mana_cost: Mapped[int] = mapped_column(SmallInteger)
    hp: Mapped[int | None] = mapped_column(SmallInteger)  # NULL for spells
    dmg: Mapped[int | None] = mapped_column(SmallInteger)  # NULL for spells that don't use it
    abilities: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    # NULL means ungrouped. SET NULL: deleting a group keeps its cards.
    group_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("card_groups.id", ondelete="SET NULL"), index=True
    )
    art_key: Mapped[str | None] = mapped_column(String(255))
