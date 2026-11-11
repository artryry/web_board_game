from fastapi import APIRouter

from app.api import (
    auth,
    card_groups,
    cards,
    catalog,
    client_logs,
    decks,
    health,
    origins,
    share,
    uploads,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(client_logs.router)
api_router.include_router(catalog.router)
api_router.include_router(origins.router)
api_router.include_router(cards.router)
api_router.include_router(card_groups.router)
api_router.include_router(decks.router)
api_router.include_router(share.router)
api_router.include_router(uploads.router)
