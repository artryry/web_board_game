# Single import point for Alembic: import every model module here so Base.metadata is complete.
from app.core.db import Base
from app.models.card import Card
from app.models.card_group import CardGroup
from app.models.deck import Deck, DeckCard
from app.models.origin import Origin
from app.models.share_code import ShareCode
from app.models.user import User

__all__ = ["Base", "Card", "CardGroup", "Deck", "DeckCard", "Origin", "ShareCode", "User"]
