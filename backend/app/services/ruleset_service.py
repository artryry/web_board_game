from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.ruleset import Ruleset
from app.schemas.common import PageParams
from app.schemas.rules import RulesetDefinition, migrate
from app.schemas.ruleset import RawDefinition, RulesetCreate, RulesetOut, RulesetUpdate
from app.services import rules_service
from app.services.common import paginate


def ruleset_definition(ruleset: Ruleset) -> RulesetDefinition:
    return RulesetDefinition.model_validate(migrate(ruleset.definition))


def ruleset_out(ruleset: Ruleset) -> RulesetOut:
    return RulesetOut(
        id=ruleset.id,
        name=ruleset.name,
        definition=ruleset_definition(ruleset),
        is_system=ruleset.is_system,
        system_key=ruleset.system_key,
        share_code=ruleset.share_code,
        created_at=ruleset.created_at,
        updated_at=ruleset.updated_at,
    )


def _readable_by(user_id: UUID) -> Any:
    return or_(Ruleset.owner_id == user_id, Ruleset.owner_id.is_(None))


async def list_rulesets(
    db: AsyncSession, user_id: UUID, page: PageParams
) -> tuple[list[Ruleset], int]:
    """System rulesets (the default) first, then the user's own, each by name."""
    stmt = (
        select(Ruleset)
        .where(_readable_by(user_id))
        .order_by(Ruleset.owner_id.is_not(None), func.lower(Ruleset.name), Ruleset.id)
    )
    return await paginate(db, stmt, page)


async def get_ruleset(db: AsyncSession, user_id: UUID, ruleset_id: UUID) -> Ruleset:
    """The user's own ruleset or a system one. Another user's ruleset gives the same 404 as a
    missing one."""
    ruleset = await db.get(Ruleset, ruleset_id)
    if ruleset is None or (ruleset.owner_id is not None and ruleset.owner_id != user_id):
        raise AppError(404, "ruleset_not_found", "Ruleset not found")
    return ruleset


async def get_own_ruleset(db: AsyncSession, user_id: UUID, ruleset_id: UUID) -> Ruleset:
    """A ruleset the user may change, delete or share: their own, never a system one."""
    ruleset = await get_ruleset(db, user_id, ruleset_id)
    if ruleset.is_system:
        raise AppError(
            403,
            "system_ruleset_read_only",
            "The default ruleset can't be changed or shared. Copy it to make your own version.",
        )
    return ruleset


def _checked_definition(raw: RawDefinition) -> RulesetDefinition:
    """The normalized definition. Unlike a deck, a ruleset can't be saved half-finished."""
    definition, errors = rules_service.validate_definition(raw)
    if definition is None:
        raise AppError(
            422,
            "invalid_ruleset",
            f"The ruleset has {len(errors)} error(s)",
            extra={"errors": [error.model_dump(mode="json") for error in errors]},
        )
    return definition


def _set_definition(ruleset: Ruleset, definition: RulesetDefinition) -> None:
    ruleset.definition = definition.model_dump(mode="json")
    ruleset.schema_version = definition.schema_version


async def _commit(db: AsyncSession, ruleset: Ruleset) -> None:
    await db.commit()
    # Loads share_code, which isn't set on a freshly inserted row.
    await db.refresh(ruleset)


async def create_ruleset(db: AsyncSession, user_id: UUID, data: RulesetCreate) -> Ruleset:
    ruleset = Ruleset(owner_id=user_id, name=data.name)
    _set_definition(ruleset, _checked_definition(data.definition))
    db.add(ruleset)
    await _commit(db, ruleset)
    return ruleset


async def update_ruleset(
    db: AsyncSession, user_id: UUID, ruleset_id: UUID, data: RulesetUpdate
) -> Ruleset:
    ruleset = await get_own_ruleset(db, user_id, ruleset_id)
    if data.definition is not None:
        _set_definition(ruleset, _checked_definition(data.definition))
    if data.name is not None:
        ruleset.name = data.name
    await _commit(db, ruleset)
    return ruleset


async def delete_ruleset(db: AsyncSession, user_id: UUID, ruleset_id: UUID) -> None:
    """Its share code goes with it (ON DELETE CASCADE). Rooms copy their ruleset when they are
    created (M6), so deleting one never breaks a game."""
    ruleset = await get_own_ruleset(db, user_id, ruleset_id)
    await db.delete(ruleset)
    await db.commit()
