from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from botocore.exceptions import ClientError
from httpx import AsyncClient, Response
from pydantic import HttpUrl, SecretStr

from app.core.config import Settings

PUBLIC_BASE_URL = "https://art.test"


def make_settings() -> Settings:
    """Settings with fixed, fake values, so tests never depend on the local .env."""
    return Settings(
        database_url=SecretStr("postgresql+asyncpg://test:test@localhost:5432/test"),
        redis_url="redis://localhost:6379/0",
        redis_password=SecretStr("test"),
        r2_endpoint=HttpUrl("https://test.r2.cloudflarestorage.com"),
        r2_access_key_id="test",
        r2_secret_access_key=SecretStr("test"),
        r2_bucket="test-bucket",
        r2_public_base_url=HttpUrl(PUBLIC_BASE_URL),
        jwt_secret=SecretStr("test-jwt-secret-that-is-at-least-32-chars"),
        jwt_algorithm="HS256",
        access_token_ttl_min=15,
        refresh_token_ttl_days=30,
        upload_max_bytes=2 * 1024 * 1024,
        upload_url_ttl_s=300,
    )


@dataclass(frozen=True)
class AuthedUser:
    id: UUID
    headers: dict[str, str]


async def register_user(client: AsyncClient, username: str) -> AuthedUser:
    response = await client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": f"{username}@example.com",
            "password": "correct-horse",
        },
    )
    assert response.status_code == 201
    headers = {"Authorization": f"Bearer {response.json()['access']}"}
    me = await client.get("/api/auth/me", headers=headers)
    return AuthedUser(id=UUID(me.json()["id"]), headers=headers)


def assert_error(response: Response, status_code: int, code: str) -> dict[str, Any]:
    """Checks the shared error body and returns its `detail`."""
    assert response.status_code == status_code, response.text
    detail: dict[str, Any] = response.json()["detail"]
    assert detail["code"] == code
    assert isinstance(detail["message"], str)
    return detail


@dataclass
class FakeS3:
    """Stands in for the R2 client: records presign calls and serves `head_object`."""

    objects: dict[str, dict[str, Any]] = field(default_factory=dict)
    presigned: list[dict[str, Any]] = field(default_factory=list)

    def put(self, key: str, size: int, content_type: str) -> None:
        self.objects[key] = {"ContentLength": size, "ContentType": content_type}

    async def generate_presigned_url(
        self,
        ClientMethod: str,  # noqa: N803 - boto3 kwarg names
        Params: dict[str, Any],  # noqa: N803
        ExpiresIn: int,  # noqa: N803
    ) -> str:
        self.presigned.append({"method": ClientMethod, "params": Params, "expires_in": ExpiresIn})
        return f"https://upload.test/{Params['Key']}?X-Amz-Signature=fake"

    async def head_object(self, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject")
        return self.objects[Key]


async def system_origin_id(client: AsyncClient, user: AuthedUser, key: str = "neutral") -> str:
    response = await client.get("/api/origins", headers=user.headers)
    assert response.status_code == 200
    origin_id: str = next(o["id"] for o in response.json()["items"] if o["system_key"] == key)
    return origin_id


async def create_origin(client: AsyncClient, user: AuthedUser, **fields: Any) -> dict[str, Any]:
    body = {"name": "Swamp", "color": "bluish_green", "icon": "droplet"} | fields
    response = await client.post("/api/origins", json=body, headers=user.headers)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


async def create_card(client: AsyncClient, user: AuthedUser, **fields: Any) -> dict[str, Any]:
    """A 2/2 creature on the neutral origin, unless `fields` say otherwise."""
    if "origin_id" not in fields:
        fields["origin_id"] = await system_origin_id(client, user)
    body = {"kind": "creature", "name": "Wolf", "mana_cost": 2, "hp": 2, "dmg": 2} | fields
    response = await client.post("/api/cards", json=body, headers=user.headers)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


async def create_group(client: AsyncClient, user: AuthedUser, name: str) -> dict[str, Any]:
    response = await client.post("/api/card-groups", json={"name": name}, headers=user.headers)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result
