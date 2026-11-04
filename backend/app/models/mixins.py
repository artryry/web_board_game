from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column


class TimestampMixin:
    # clock_timestamp(), not now(): now() is fixed for a whole transaction, so rows created
    # together (an import, or a test) would tie and "newest first" would be random.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        onupdate=func.clock_timestamp(),
    )

    # Fetch DB-generated values (timestamps) with RETURNING on INSERT and UPDATE. Otherwise
    # reading them after a flush would trigger a lazy load, which async sessions don't allow.
    __mapper_args__: Any = {"eager_defaults": True}
