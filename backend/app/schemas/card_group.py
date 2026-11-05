from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.schemas.common import ContentName


class CardGroupCreate(BaseModel):
    name: ContentName


class CardGroupUpdate(BaseModel):
    name: ContentName


class CardGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    card_count: int
    # Set while the group is shared; null after it is revoked.
    share_code: str | None
    created_at: datetime
    updated_at: datetime
