# Single import point for Alembic: import every model module here so Base.metadata is complete.
from app.core.db import Base
from app.models.card import Card
from app.models.card_group import CardGroup
from app.models.origin import Origin
from app.models.user import User

__all__ = ["Base", "Card", "CardGroup", "Origin", "User"]
