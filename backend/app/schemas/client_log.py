from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

MAX_ENTRIES = 20
MAX_BREADCRUMBS = 20

EventName = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_.]{1,64}$")]
ContextKey = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]{1,40}$")]
ContextValue = Annotated[str, StringConstraints(max_length=200)] | int | float | bool | None


class ClientBreadcrumb(BaseModel):
    """One of the steps the browser took before an error: a page view, an API call, ..."""

    model_config = ConfigDict(extra="forbid")

    ts: datetime
    level: Literal["debug", "info", "warn", "error"]
    event: EventName
    context: Annotated[dict[ContextKey, ContextValue], Field(max_length=5)] = {}


class ClientLogEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    level: Literal["warn", "error"]
    event: EventName
    message: Annotated[str, StringConstraints(max_length=500)] = ""
    stack: Annotated[str, StringConstraints(max_length=4000)] | None = None
    # The path, without the query string.
    page: Annotated[str, StringConstraints(max_length=200)]
    client_ts: datetime
    context: Annotated[dict[ContextKey, ContextValue], Field(max_length=20)] = {}
    breadcrumbs: Annotated[list[ClientBreadcrumb], Field(max_length=MAX_BREADCRUMBS)] = []

    @model_validator(mode="after")
    def _breadcrumbs_only_on_errors(self) -> "ClientLogEntry":
        if self.breadcrumbs and self.level != "error":
            raise ValueError("Only error entries carry breadcrumbs")
        return self


class ClientLogBatch(BaseModel):
    """Warnings and errors from the browser, sent in batches by its logger."""

    model_config = ConfigDict(extra="forbid")

    entries: Annotated[list[ClientLogEntry], Field(min_length=1, max_length=MAX_ENTRIES)]
