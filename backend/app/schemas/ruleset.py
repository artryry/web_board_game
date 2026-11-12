from datetime import datetime
from typing import Any, Self
from uuid import UUID

from pydantic import BaseModel, model_validator

from app.schemas.common import ContentName, reject_explicit_nulls
from app.schemas.rules import RuleError, RulesetDefinition

# Requests take the definition as a plain JSON object: if FastAPI parsed it into a
# RulesetDefinition, a bad one would get FastAPI's generic 422 instead of RuleErrors with paths
# the rules editor can show. Responses carry the typed RulesetDefinition.
RawDefinition = dict[str, Any]


class RulesetCreate(BaseModel):
    name: ContentName
    definition: RawDefinition


class RulesetUpdate(BaseModel):
    """Partial update: only the fields that are sent change. A definition replaces the whole
    one."""

    name: ContentName | None = None
    definition: RawDefinition | None = None

    @model_validator(mode="after")
    def _required_fields_not_null(self) -> Self:
        reject_explicit_nulls(self, ("name", "definition"))
        return self


class RulesetOut(BaseModel):
    id: UUID
    name: str
    definition: RulesetDefinition
    # The default ruleset is a read-only system ruleset shared by everyone.
    is_system: bool
    system_key: str | None
    share_code: str | None
    created_at: datetime
    updated_at: datetime


class RulesetValidateRequest(BaseModel):
    definition: RawDefinition


class RulesetValidation(BaseModel):
    valid: bool
    errors: list[RuleError]
    # The normalized definition (every default filled in) when it is valid, else null.
    definition: RulesetDefinition | None
