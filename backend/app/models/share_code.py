import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

SHARE_CODE_LENGTH = 10


class ShareCode(Base):
    """A code that lets any logged-in user preview and import one deck or card group.

    One FK column per kind, so deleting the deck or group deletes its code in the database.
    """

    __tablename__ = "share_codes"
    __table_args__ = (
        CheckConstraint("num_nonnulls(deck_id, card_group_id) = 1", name="one_target"),
    )

    code: Mapped[str] = mapped_column(String(SHARE_CODE_LENGTH), primary_key=True)
    deck_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("decks.id", ondelete="CASCADE"), unique=True
    )
    card_group_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("card_groups.id", ondelete="CASCADE"), unique=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
