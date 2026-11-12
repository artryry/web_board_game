from uuid import UUID

from fastapi import APIRouter, status

from app.core.deps import CurrentUser, Db, Pagination
from app.schemas.common import Page
from app.schemas.ruleset import (
    RulesetCreate,
    RulesetOut,
    RulesetUpdate,
    RulesetValidateRequest,
    RulesetValidation,
)
from app.schemas.share import ShareCodeOut
from app.services import rules_service, ruleset_service, share_service

router = APIRouter(prefix="/rulesets", tags=["rulesets"])


@router.get("", response_model=Page[RulesetOut])
async def list_rulesets(user: CurrentUser, db: Db, page: Pagination) -> Page[RulesetOut]:
    rulesets, total = await ruleset_service.list_rulesets(db, user.id, page)
    return Page[RulesetOut](
        items=[ruleset_service.ruleset_out(ruleset) for ruleset in rulesets], total=total
    )


@router.post("", response_model=RulesetOut, status_code=status.HTTP_201_CREATED)
async def create_ruleset(data: RulesetCreate, user: CurrentUser, db: Db) -> RulesetOut:
    ruleset = await ruleset_service.create_ruleset(db, user.id, data)
    return ruleset_service.ruleset_out(ruleset)


@router.post("/validate", response_model=RulesetValidation)
async def validate_ruleset(data: RulesetValidateRequest, _user: CurrentUser) -> RulesetValidation:
    """Always 200: `valid` says whether the definition can be saved, and `errors` lists every
    problem with its path."""
    definition, errors = rules_service.validate_definition(data.definition)
    return RulesetValidation(valid=definition is not None, errors=errors, definition=definition)


@router.get("/{ruleset_id}", response_model=RulesetOut)
async def get_ruleset(ruleset_id: UUID, user: CurrentUser, db: Db) -> RulesetOut:
    ruleset = await ruleset_service.get_ruleset(db, user.id, ruleset_id)
    return ruleset_service.ruleset_out(ruleset)


@router.patch("/{ruleset_id}", response_model=RulesetOut)
async def update_ruleset(
    ruleset_id: UUID, data: RulesetUpdate, user: CurrentUser, db: Db
) -> RulesetOut:
    ruleset = await ruleset_service.update_ruleset(db, user.id, ruleset_id, data)
    return ruleset_service.ruleset_out(ruleset)


@router.delete("/{ruleset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ruleset(ruleset_id: UUID, user: CurrentUser, db: Db) -> None:
    await ruleset_service.delete_ruleset(db, user.id, ruleset_id)


@router.post("/{ruleset_id}/share", response_model=ShareCodeOut)
async def share_ruleset(ruleset_id: UUID, user: CurrentUser, db: Db) -> ShareCodeOut:
    return ShareCodeOut(share_code=await share_service.share_ruleset(db, user.id, ruleset_id))


@router.delete("/{ruleset_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_ruleset_share(ruleset_id: UUID, user: CurrentUser, db: Db) -> None:
    await share_service.revoke_ruleset(db, user.id, ruleset_id)
