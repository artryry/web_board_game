from fastapi import APIRouter

from app.core.deps import CurrentUser
from app.schemas.catalog import CatalogOut
from app.services import catalog_service

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("", response_model=CatalogOut)
async def get_catalog(_user: CurrentUser) -> CatalogOut:
    return catalog_service.build_catalog()
