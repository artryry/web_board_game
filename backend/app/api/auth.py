from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.deps import CurrentUser, get_db
from app.core.errors import UnauthorizedError
from app.schemas.auth import AccessToken, LoginRequest, RegisterRequest, UserOut
from app.services import auth_service
from app.services.auth_service import TokenPair

router = APIRouter(prefix="/auth", tags=["auth"])

Db = Annotated[AsyncSession, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]

REFRESH_COOKIE = "refresh_token"
# The browser sends the cookie to the auth routes only; the rest of the API never sees it.
REFRESH_COOKIE_PATH = "/api/auth"


def _start_session(response: Response, tokens: TokenPair, settings: Settings) -> AccessToken:
    """Puts the refresh token in its cookie and returns the access token for the body."""
    response.set_cookie(
        REFRESH_COOKIE,
        tokens.refresh,
        max_age=settings.refresh_token_ttl_days * 24 * 60 * 60,
        path=REFRESH_COOKIE_PATH,
        secure=settings.refresh_cookie_secure,
        httponly=True,
        # Never sent with requests from other sites, so they can't use it to refresh or log out.
        samesite="strict",
    )
    return AccessToken(access=tokens.access)


@router.post("/register", response_model=AccessToken, status_code=status.HTTP_201_CREATED)
async def register(
    data: RegisterRequest, response: Response, db: Db, settings: AppSettings
) -> AccessToken:
    return _start_session(response, await auth_service.register(db, data, settings), settings)


@router.post("/login", response_model=AccessToken)
async def login(
    data: LoginRequest, response: Response, db: Db, settings: AppSettings
) -> AccessToken:
    return _start_session(response, await auth_service.authenticate(db, data, settings), settings)


@router.post("/refresh", response_model=AccessToken)
async def refresh(
    response: Response,
    db: Db,
    settings: AppSettings,
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
) -> AccessToken:
    if refresh_token is None:
        raise UnauthorizedError("not_authenticated", "Missing refresh token cookie")
    tokens = await auth_service.refresh(db, refresh_token, settings)
    return _start_session(response, tokens, settings)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response, settings: AppSettings) -> None:
    """Deletes the refresh cookie. It needs no access token, so it works after that expired.

    Tokens are stateless, so this doesn't revoke anything: it only makes the browser forget the
    refresh token.
    """
    response.delete_cookie(
        REFRESH_COOKIE,
        path=REFRESH_COOKIE_PATH,
        secure=settings.refresh_cookie_secure,
        httponly=True,
        samesite="strict",
    )


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)
