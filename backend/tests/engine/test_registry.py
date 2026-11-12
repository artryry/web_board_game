from typing import Annotated, Literal

import pytest
from pydantic import Field

from app.engine.registry import (
    CostSpec,
    DmgUse,
    FeatureModule,
    InvalidParamsError,
    ModuleKind,
    ModuleParams,
    ModuleRegistry,
    SpellModule,
    UnknownModuleError,
    registry,
)


class SampleFeature(FeatureModule):
    name = "Sample"
    description = "A feature for registry tests."
    cost_spec = CostSpec(base=1, per_param={"amount": 2})

    class Params(ModuleParams):
        amount: Annotated[int, Field(ge=0, le=3)] = 1


class OtherFeature(FeatureModule):
    name = "Other"
    description = "Another feature for registry tests."
    cost_spec = CostSpec(base=0)


def test_register_and_get() -> None:
    reg = ModuleRegistry()
    reg.register(SampleFeature, "sample")

    assert reg.get(FeatureModule, "sample") is SampleFeature
    assert SampleFeature.key == "sample"
    assert reg.all(FeatureModule) == [SampleFeature]


def test_duplicate_key_fails() -> None:
    reg = ModuleRegistry()
    reg.register(SampleFeature, "sample")

    with pytest.raises(ValueError, match="Duplicate feature module key 'sample'"):
        reg.register(OtherFeature, "sample")


def test_unknown_key() -> None:
    reg = ModuleRegistry()

    with pytest.raises(UnknownModuleError) as exc_info:
        reg.get(FeatureModule, "missing")

    assert exc_info.value.code == "unknown_module"
    assert exc_info.value.kind == ModuleKind.FEATURE
    assert exc_info.value.key == "missing"


def test_key_of_another_kind_is_unknown() -> None:
    with pytest.raises(UnknownModuleError):
        registry.get(SpellModule, "taunt")


def test_validate_params_fills_defaults() -> None:
    reg = ModuleRegistry()
    reg.register(SampleFeature, "sample")

    params = reg.validate_params(FeatureModule, "sample", {})

    assert params.model_dump() == {"amount": 1}


@pytest.mark.parametrize("params", [{"amount": 4}, {"amount": "lots"}, {"extra": 1}])
def test_validate_params_rejects_bad_params(params: dict[str, object]) -> None:
    reg = ModuleRegistry()
    reg.register(SampleFeature, "sample")

    with pytest.raises(InvalidParamsError) as exc_info:
        reg.validate_params(FeatureModule, "sample", params)

    assert exc_info.value.code == "invalid_params"
    assert "sample" in exc_info.value.message


def test_invalid_params_keeps_one_error_per_param() -> None:
    reg = ModuleRegistry()
    reg.register(SampleFeature, "sample")

    with pytest.raises(InvalidParamsError) as exc_info:
        reg.validate_params(FeatureModule, "sample", {"amount": 4, "extra": 1})

    assert [(item["loc"], item["type"]) for item in exc_info.value.errors] == [
        (("amount",), "less_than_equal"),
        (("extra",), "extra_forbidden"),
    ]


def test_cost_reads_the_cost_spec() -> None:
    assert SampleFeature.cost(SampleFeature.Params(amount=3)) == 7


def test_loader_runs_once_before_the_first_lookup() -> None:
    calls: list[int] = []
    reg = ModuleRegistry(loader=lambda: calls.append(1))

    reg.register(SampleFeature, "sample")
    assert calls == []
    reg.all(FeatureModule)
    reg.get(FeatureModule, "sample")
    assert calls == [1]


def test_missing_name_fails() -> None:
    class NoName(FeatureModule):
        description = "No name."
        cost_spec = CostSpec()

    with pytest.raises(TypeError, match="must set 'name'"):
        ModuleRegistry().register(NoName, "no_name")


def test_missing_cost_spec_fails() -> None:
    class NoCost(FeatureModule):
        name = "No cost"
        description = "No cost spec."

    with pytest.raises(TypeError, match="must set 'cost_spec'"):
        ModuleRegistry().register(NoCost, "no_cost")


def test_spell_without_dmg_use_fails() -> None:
    class NoDmgUse(SpellModule):
        name = "No dmg use"
        description = "No dmg use."
        cost_spec = CostSpec()

    with pytest.raises(TypeError, match="must set 'dmg_use'"):
        ModuleRegistry().register(NoDmgUse, "no_dmg_use")


def test_cost_param_must_be_an_int_param() -> None:
    class BadCost(SpellModule):
        name = "Bad cost"
        description = "Its cost reads a non-int param."
        dmg_use = DmgUse.NONE
        cost_spec = CostSpec(per_param={"target": 1})

        class Params(ModuleParams):
            target: Literal["a", "b"] = "a"

    class MissingCostParam(FeatureModule):
        name = "Missing cost param"
        description = "Its cost reads a param that doesn't exist."
        cost_spec = CostSpec(per_param={"amount": 1})

    with pytest.raises(TypeError, match="cost param 'target'"):
        ModuleRegistry().register(BadCost, "bad_cost")
    with pytest.raises(TypeError, match="cost param 'amount'"):
        ModuleRegistry().register(MissingCostParam, "missing_cost_param")
