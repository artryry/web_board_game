"""The module registry: how cards, origins and rules refer to ready-made game modules.

Every module is a class registered under a key for its kind. A module declares a display name,
a description and a `Params` model whose JSON Schema the catalog sends to the frontend. Features
and spells also declare a cost as data (`CostSpec`), so the frontend can compute the same cost
suggestion. Behaviour hooks are added in M5.
"""

import importlib
from collections.abc import Callable, Mapping
from enum import StrEnum
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError

_BUILTIN_MODULES_PACKAGE = "app.engine.modules"


class ModuleKind(StrEnum):
    PHASE = "phase"
    FEATURE = "feature"
    SPELL = "spell"
    FIELD_EFFECT = "field_effect"


class DmgUse(StrEnum):
    """How a spell effect uses the card's `dmg` value."""

    DAMAGE = "damage"  # 1..99
    HEAL = "heal"  # -99..-1: the amount healed, as a negative number
    NONE = "none"  # null (0 is accepted and stored as null)


class ModuleError(ValueError):
    """A module reference that can't be used. `code` is the machine-readable reason."""

    code: ClassVar[str]

    def __init__(self, kind: ModuleKind, key: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.key = key
        self.message = message


class UnknownModuleError(ModuleError):
    code = "unknown_module"

    def __init__(self, kind: ModuleKind, key: str) -> None:
        super().__init__(kind, key, f"Unknown {kind} module '{key}'")


class InvalidParamsError(ModuleError):
    code = "invalid_params"

    def __init__(self, kind: ModuleKind, key: str, error: ValidationError) -> None:
        details = "; ".join(
            f"{'.'.join(str(part) for part in item['loc']) or 'params'}: {item['msg']}"
            for item in error.errors()
        )
        super().__init__(kind, key, f"Invalid params for {kind} module '{key}': {details}")


class ModuleParams(BaseModel):
    """Base for every module's `Params`. Unknown params are rejected."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class EmptyParams(ModuleParams):
    pass


class ModuleRef(BaseModel):
    """A stored reference to a module: `{"key": ..., "params": {...}}`."""

    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=64)
    params: dict[str, Any] = Field(default_factory=dict)


class CostSpec(BaseModel):
    """A module's cost as data: `base + Σ weight × params[name]` over int params."""

    model_config = ConfigDict(frozen=True)

    base: int = 0
    per_param: dict[str, int] = Field(default_factory=dict)

    def evaluate(self, params: ModuleParams) -> int:
        return self.base + sum(
            weight * int(getattr(params, name)) for name, weight in self.per_param.items()
        )


class Module:
    kind: ClassVar[ModuleKind]
    key: ClassVar[str]
    name: ClassVar[str]
    description: ClassVar[str]
    Params: ClassVar[type[ModuleParams]] = EmptyParams


class PhaseModule(Module):
    kind = ModuleKind.PHASE
    # Interactive phases stop the runner and wait for player actions.
    interactive: ClassVar[bool] = False


class CostedModule(Module):
    cost_spec: ClassVar[CostSpec]

    @classmethod
    def cost(cls, params: ModuleParams) -> int:
        return cls.cost_spec.evaluate(params)


class FeatureModule(CostedModule):
    kind = ModuleKind.FEATURE


class SpellModule(CostedModule):
    kind = ModuleKind.SPELL
    dmg_use: ClassVar[DmgUse]


class FieldEffectModule(Module):
    kind = ModuleKind.FIELD_EFFECT


def _check_declaration(cls: type[Module]) -> None:
    """Fail at import when a module class is missing something the catalog needs."""
    for attr in ("name", "description"):
        if not getattr(cls, attr, ""):
            raise TypeError(f"Module {cls.__name__} must set '{attr}'")
    if not issubclass(cls.Params, ModuleParams):
        raise TypeError(f"Module {cls.__name__}: Params must subclass ModuleParams")
    if issubclass(cls, SpellModule) and not isinstance(getattr(cls, "dmg_use", None), DmgUse):
        raise TypeError(f"Spell module {cls.__name__} must set 'dmg_use'")
    if issubclass(cls, CostedModule):
        cost_spec = getattr(cls, "cost_spec", None)
        if not isinstance(cost_spec, CostSpec):
            raise TypeError(f"Module {cls.__name__} must set 'cost_spec'")
        fields = cls.Params.model_fields
        for name in cost_spec.per_param:
            if name not in fields or fields[name].annotation is not int:
                raise TypeError(f"Module {cls.__name__}: cost param '{name}' is not an int param")


class ModuleRegistry:
    """Modules by kind and key.

    `loader` runs once, before the first lookup, so built-in modules are registered no matter
    which code imports the registry first.
    """

    def __init__(self, loader: Callable[[], None] | None = None) -> None:
        self._modules: dict[ModuleKind, dict[str, type[Module]]] = {kind: {} for kind in ModuleKind}
        self._loader = loader

    def _ensure_loaded(self) -> None:
        if self._loader is not None:
            loader, self._loader = self._loader, None
            loader()

    def register(self, cls: type[Module], key: str) -> None:
        modules = self._modules[cls.kind]
        if key in modules:
            raise ValueError(f"Duplicate {cls.kind} module key '{key}'")
        _check_declaration(cls)
        cls.key = key
        modules[key] = cls

    def get[M: Module](self, base: type[M], key: str) -> type[M]:
        self._ensure_loaded()
        cls = self._modules[base.kind].get(key)
        if cls is None or not issubclass(cls, base):
            raise UnknownModuleError(base.kind, key)
        return cls

    def all[M: Module](self, base: type[M]) -> list[type[M]]:
        self._ensure_loaded()
        return [cls for cls in self._modules[base.kind].values() if issubclass(cls, base)]

    def validate_params[M: Module](
        self, base: type[M], key: str, params: Mapping[str, Any]
    ) -> ModuleParams:
        module = self.get(base, key)
        try:
            return module.Params.model_validate(params)
        except ValidationError as exc:
            raise InvalidParamsError(base.kind, key, exc) from None


def _load_builtin_modules() -> None:
    importlib.import_module(_BUILTIN_MODULES_PACKAGE)


registry = ModuleRegistry(loader=_load_builtin_modules)


def _decorator[M: Module](key: str) -> Callable[[type[M]], type[M]]:
    def register(cls: type[M]) -> type[M]:
        registry.register(cls, key)
        return cls

    return register


def phase[M: PhaseModule](key: str) -> Callable[[type[M]], type[M]]:
    return _decorator(key)


def feature[M: FeatureModule](key: str) -> Callable[[type[M]], type[M]]:
    return _decorator(key)


def spell[M: SpellModule](key: str) -> Callable[[type[M]], type[M]]:
    return _decorator(key)


def field_effect[M: FieldEffectModule](key: str) -> Callable[[type[M]], type[M]]:
    return _decorator(key)
