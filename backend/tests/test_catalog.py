from httpx import AsyncClient

from app.engine.registry import (
    FeatureModule,
    FieldEffectModule,
    Module,
    PhaseModule,
    SpellModule,
    registry,
)
from app.schemas.origin import ORIGIN_COLOR_HEX, ORIGIN_ICONS
from tests.helpers import AuthedUser, assert_error

SECTIONS: dict[str, type[Module]] = {
    "phases": PhaseModule,
    "features": FeatureModule,
    "spells": SpellModule,
    "field_effects": FieldEffectModule,
}


async def test_catalog_needs_login(client: AsyncClient) -> None:
    response = await client.get("/api/catalog")

    assert_error(response, 401, "not_authenticated")


async def test_catalog_lists_every_module_by_kind(client: AsyncClient, alice: AuthedUser) -> None:
    response = await client.get("/api/catalog", headers=alice.headers)

    assert response.status_code == 200
    body = response.json()
    for section, base in SECTIONS.items():
        listed = {entry["key"]: entry for entry in body[section]}
        assert set(listed) == {module.key for module in registry.all(base)}
        for module in registry.all(base):
            entry = listed[module.key]
            assert entry["name"] == module.name
            assert entry["description"] == module.description
            assert entry["params_schema"] == module.Params.model_json_schema()


async def test_catalog_module_extras(client: AsyncClient, alice: AuthedUser) -> None:
    body = (await client.get("/api/catalog", headers=alice.headers)).json()
    phases = {entry["key"]: entry for entry in body["phases"]}
    features = {entry["key"]: entry for entry in body["features"]}
    spells = {entry["key"]: entry for entry in body["spells"]}

    assert phases["action_phase"]["interactive"] is True
    assert phases["draw"]["interactive"] is False
    assert features["taunt"]["cost"] == {"base": 2, "per_param": {}}
    assert features["armor"]["cost"] == {"base": 0, "per_param": {"amount": 1}}
    assert spells["heal"]["dmg_use"] == "heal"
    assert spells["deal_damage"]["dmg_use"] == "damage"
    assert spells["draw_cards"]["dmg_use"] == "none"
    assert spells["draw_cards"]["cost"] == {"base": 0, "per_param": {"count": 2}}
    assert "cost" not in body["field_effects"][0]


async def test_catalog_lists_origin_colors_and_icons(
    client: AsyncClient, alice: AuthedUser
) -> None:
    body = (await client.get("/api/catalog", headers=alice.headers)).json()

    assert body["origin_colors"] == [
        {"key": key, "hex": hex_} for key, hex_ in ORIGIN_COLOR_HEX.items()
    ]
    assert body["origin_icons"] == list(ORIGIN_ICONS)
