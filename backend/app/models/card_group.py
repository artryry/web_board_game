import uuid

from sqlalchemy import ForeignKey, Index, String, func, select
from sqlalchemy.orm import Mapped, column_property, mapped_column

from app.core.db import Base
from app.models.card import Card
from app.models.mixins import TimestampMixin


class CardGroup(TimestampMixin, Base):
    """A folder in a user's card library. A card is in at most one group."""

    __tablename__ = "card_groups"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(40))

    # Loaded with the group. A freshly inserted group needs a refresh before it is read.
    card_count: Mapped[int] = column_property(
        select(func.count(Card.id))
        .where(Card.group_id == id)
        .correlate_except(Card)
        .scalar_subquery()
    )


# Unique per owner, ignoring case. Its leading owner_id column also serves "my groups" queries.
Index(
    "uq_card_groups_owner_id_name_lower",
    CardGroup.owner_id,
    func.lower(CardGroup.name),
    unique=True,
)
