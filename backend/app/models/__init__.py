# Single import point for Alembic: import every model module here so Base.metadata is complete.
from app.core.db import Base

__all__ = ["Base"]
