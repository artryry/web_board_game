from collections.abc import Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.interfaces import ORMOption

from app.core.errors import AppError
from app.engine.registry import Module, ModuleError, ModuleParams, ModuleRef, registry
from app.models.mixins import OwnedMixin
from app.schemas.common import PageParams


async def get_owned[M: OwnedMixin](
    db: AsyncSession,
    model: type[M],
    row_id: UUID,
    owner_id: UUID,
    code: str,
    message: str,
    options: Sequence[ORMOption] = (),
) -> M:
    """The row if `owner_id` owns it. Another user's row gives the same 404 as a missing one,
    so a request can't tell whether an id exists. `options` are loader options, such as
    `selectinload`."""
    row = await db.get(model, row_id, options=options)
    if row is None or row.owner_id != owner_id:
        raise AppError(404, code, message)
    return row


async def id_name_list(db: AsyncSession, stmt: Select[UUID, str]) -> list[dict[str, str]]:
    """`[{id, name}]` for an error body, for example the decks that still hold a card."""
    rows = await db.execute(stmt)
    return [{"id": str(row_id), "name": name} for row_id, name in rows]


async def paginate[M](db: AsyncSession, stmt: Select[M], page: PageParams) -> tuple[list[M], int]:
    """One page of `stmt`'s rows, plus the total number of matching rows."""
    total = await db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows = await db.scalars(stmt.limit(page.limit).offset(page.offset))
    return list(rows), total or 0


def resolve_module[M: Module](base: type[M], ref: ModuleRef) -> tuple[type[M], ModuleParams]:
    """Look a module reference up in the registry; a bad key or bad params give a 422."""
    try:
        module = registry.get(base, ref.key)
        params = registry.validate_params(base, ref.key, ref.params)
    except ModuleError as exc:
        raise AppError(422, exc.code, exc.message) from None
    return module, params


def normalize_module_refs[M: Module](
    base: type[M], refs: Sequence[ModuleRef]
) -> list[dict[str, Any]]:
    """Validated `{key, params}` dicts, with param defaults filled in, ready for a JSONB column."""
    normalized = []
    for ref in refs:
        _, params = resolve_module(base, ref)
        normalized.append({"key": ref.key, "params": params.model_dump(mode="json")})
    return normalized


def has_duplicate_keys(refs: Sequence[ModuleRef]) -> bool:
    return len({ref.key for ref in refs}) != len(refs)
