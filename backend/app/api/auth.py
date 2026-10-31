from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.deps import CurrentUser, get_db
from app.schemas.auth import LoginRequest, RefreshRequest, RegisterRequest, TokenPair, UserOut
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

Db = Annotated[AsyncSession, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def register(data: RegisterRequest, db: Db, settings: AppSettings) -> TokenPair:
    return await auth_service.register(db, data, settings)


@router.post("/login", response_model=TokenPair)
async def login(data: LoginRequest, db: Db, settings: AppSettings) -> TokenPair:
    return await auth_service.authenticate(db, data, settings)


@router.post("/refresh", response_model=TokenPair)
async def refresh(data: RefreshRequest, db: Db, settings: AppSettings) -> TokenPair:
    return await auth_service.refresh(db, data.refresh, settings)


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)
