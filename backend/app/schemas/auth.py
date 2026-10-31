from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

# Upper bound on passwords so oversized input never reaches argon2.
_PASSWORD_MAX_LENGTH = 128


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_]+$")
    email: EmailStr
    password: str = Field(min_length=8, max_length=_PASSWORD_MAX_LENGTH)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=_PASSWORD_MAX_LENGTH)


class RefreshRequest(BaseModel):
    refresh: str


class TokenPair(BaseModel):
    access: str
    refresh: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str
    email: str
    created_at: datetime
