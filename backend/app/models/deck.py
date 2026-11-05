import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, SmallInteger, String, func, select
from sqlalchemy.orm import Mapped, column_property, mapped_column, relationship

from app.core.db import Base
from app.models.card import Card
from app.models.mixins import OwnedMixin, TimestampMixin
from app.models.share_code import ShareCode


class DeckCard(Base):
    """How many copies of one card a deck holds."""

    __tablename__ = "deck_cards"
    __table_args__ = (CheckConstraint("count >= 1", name="count_positive"),)

    deck_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("decks.id", ondelete="CASCADE"), primary_key=True
    )
    # A card a deck holds can't be deleted; the card service answers with 409 card_in_use first.
    # The check is deferred to COMMIT rather than RESTRICT: deleting a user cascades to their
    # cards before their decks, and an immediate check would fail while the deck_cards rows
    # still exist. At COMMIT every cascade has run. The index serves the in-use lookups and the
    # FK check.
    card_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cards.id", deferrable=True, initially="DEFERRED"), primary_key=True, index=True
    )
    count: Mapped[int] = mapped_column(SmallInteger)

    # lazy="raise": async sessions can't lazy-load, so every query loads cards explicitly.
    card: Mapped[Card] = relationship(lazy="raise")


class Deck(OwnedMixin, TimestampMixin, Base):
    """One origin plus neutral cards. Size and copy rules come from the ruleset (M4)."""

    __tablename__ = "decks"
    __table_args__ = (
        # Covers "my decks" and the origin-in-use check.
        Index("ix_decks_owner_id_origin_id", "owner_id", "origin_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(40))
    # RESTRICT: the origin service answers with 409 origin_in_use before this is ever hit.
    origin_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("origins.id", ondelete="RESTRICT"))

    # passive_deletes: the database removes the rows (ON DELETE CASCADE), so deleting a deck
    # doesn't need to load them first.
    cards: Mapped[list[DeckCard]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True, lazy="raise"
    )

    # Loaded with the deck. A written deck is re-loaded before it is read.
    card_count: Mapped[int] = column_property(
        select(func.coalesce(func.sum(DeckCard.count), 0))
        .where(DeckCard.deck_id == id)
        .correlate_except(DeckCard)
        .scalar_subquery()
    )
    share_code: Mapped[str | None] = column_property(
        select(ShareCode.code)
        .where(ShareCode.deck_id == id)
        .correlate_except(ShareCode)
        .scalar_subquery()
    )
