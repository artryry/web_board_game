from fastapi import APIRouter

from app.api import auth, card_groups, cards, catalog, health, origins, uploads

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(catalog.router)
api_router.include_router(origins.router)
api_router.include_router(cards.router)
api_router.include_router(card_groups.router)
api_router.include_router(uploads.router)
