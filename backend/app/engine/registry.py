"""The module registry: how cards, origins and rules refer to ready-made game modules.

Every module is a class registered under a key for its kind. A module declares a display name,
a description and a `Params` model whose JSON Schema the catalog sends to the frontend. Features
and spells also declare a cost as data (`CostSpec`), so the frontend can compute the same cost
suggestion.

Behaviour lives in hook methods with do-nothing defaults. The engine builds a module with its
parsed params (`registry.build`) and calls the hooks of every module involved, so the core never
checks a module's key. Hooks change the game only through the `EngineContext` they are given.

`app.schemas.rules` imports this file, and the engine's state imports that, so engine types are
imported here for type checking only.
"""

import importlib
from collections.abc import Callable, Mapping
from enum import StrEnum
from typing import TYPE_CHECKING, Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from pydantic_core import ErrorDetails

if TYPE_CHECKING:
    from app.engine.actions import ActionKind, Target
    from app.engine.context import EngineContext
    from app.engine.seats import Seat
    from app.engine.snapshots import CardSnapshot, OriginSnapshot
    from app.engine.state import CreatureInstance

_BUILTIN_MODULES_PACKAGE = "app.engine.modules"

# Who may act in an interactive phase: the active player only, or both players.
PhaseActor = Literal["active", "both"]


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
        # Kept one per param, so the rules validator can point at each bad value.
        self.errors: list[ErrorDetails] = error.errors()
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


class StatDelta(BaseModel):
    """A change to a creature's HP and DMG, as hooks return it."""

    # The last flag only marks the fields required in the output JSON Schema (a creature's
    # `field_bonus` in the game socket's messages, M6).
    model_config = ConfigDict(
        extra="forbid", frozen=True, json_schema_serialization_defaults_required=True
    )

    hp: int = 0
    dmg: int = 0

    def __add__(self, other: "StatDelta") -> "StatDelta":
        return StatDelta(hp=self.hp + other.hp, dmg=self.dmg + other.dmg)


NO_CHANGE = StatDelta()

ALL_ACTION_KINDS: frozenset["ActionKind"] = frozenset(("play", "move", "attack"))


class Module:
    kind: ClassVar[ModuleKind]
    key: ClassVar[str]
    name: ClassVar[str]
    description: ClassVar[str]
    Params: ClassVar[type[ModuleParams]] = EmptyParams

    # An instance of the module's `Params`. A module that reads it redeclares it as
    # `params: Params`; `Any` here lets that narrower type check in mypy and Pylance alike.
    params: Any

    def __init__(self, params: ModuleParams) -> None:
        self.params = params


class PhaseModule(Module):
    kind = ModuleKind.PHASE
    # Interactive phases stop the runner and wait for player actions.
    interactive: ClassVar[bool] = False

    def run(self, ctx: "EngineContext", seat: "Seat") -> None:
        """Runs an automatic phase for `seat`: the active player, or each player in Setup."""

    def actor(self) -> PhaseActor:
        """Who may act in an interactive phase."""
        return "active"

    def allowed(self) -> frozenset["ActionKind"]:
        """The action kinds an interactive phase allows (ending the phase always is)."""
        return ALL_ACTION_KINDS

    def time_limit_s(self) -> int | None:
        """How long players have in an interactive phase. M6 turns it into a deadline."""
        return None


class CostedModule(Module):
    cost_spec: ClassVar[CostSpec]

    @classmethod
    def cost(cls, params: ModuleParams) -> int:
        return cls.cost_spec.evaluate(params)


class FeatureModule(CostedModule):
    """A creature's ability."""

    kind = ModuleKind.FEATURE

    def must_be_attacked_first(self) -> bool:
        return False

    def ready_when_summoned(self) -> bool:
        """True lets the creature act on the turn it is summoned."""
        return False

    def attack_lanes(self, lane: int, lanes: int) -> set[int]:
        """The lanes a creature in `lane` can attack, on a board of `lanes` lanes."""
        return {lane}

    def damage_taken(self, amount: int) -> int:
        """The damage a hit of `amount` does to the creature."""
        return amount

    def field_bonus(self, creature: "CreatureInstance", origin: "OriginSnapshot") -> StatDelta:
        """The bonus the creature gets while it stands in one of its owner's sections that isn't
        conquered. `origin` is its owner's deck origin."""
        return NO_CHANGE

    def on_damage_dealt(
        self, ctx: "EngineContext", creature: "CreatureInstance", amount: int
    ) -> None:
        """After the creature deals `amount` damage in a fight, attacking or defending."""

    def on_death(self, ctx: "EngineContext", creature: "CreatureInstance", lane: int) -> None:
        """After the creature died in `lane` and left the board."""


class SpellModule(CostedModule):
    """A spell card's effect."""

    kind = ModuleKind.SPELL
    dmg_use: ClassVar[DmgUse]

    def targets(self, ctx: "EngineContext", caster: "Seat") -> list["Target | None"]:
        """Every valid target; `None` means the spell takes no target."""
        return [None]

    def resolve(
        self, ctx: "EngineContext", caster: "Seat", card: "CardSnapshot", target: "Target | None"
    ) -> None:
        raise NotImplementedError(f"Spell module '{self.key}' doesn't resolve")


class FieldEffectModule(Module):
    """An effect of a player's deck origin. It belongs to that player (its owner)."""

    kind = ModuleKind.FIELD_EFFECT

    def on_game_start(self, ctx: "EngineContext", owner: "Seat") -> None:
        """Once, when the board is built."""

    def on_turn_start(self, ctx: "EngineContext", owner: "Seat") -> None:
        """At the start of each of the owner's turns."""

    def field_bonus(self, creature: "CreatureInstance", origin: "OriginSnapshot") -> StatDelta:
        """The bonus one of the owner's creatures gets while it stands in one of the owner's
        sections that isn't conquered. `origin` is the owner's deck origin."""
        return NO_CHANGE

    def move_uses_action(self) -> bool:
        return True

    def cost_change(self, card: "CardSnapshot") -> int:
        """Added to the mana cost of the owner's cards; the cost never goes below 0."""
        return 0

    def spell_damage_bonus(self) -> int:
        """Added to the damage of the owner's damage spells."""
        return 0

    def attacker_penalty(self) -> StatDelta:
        """What an enemy creature loses when it attacks one of the owner's sections that isn't
        conquered: `hp` is damage it takes, `dmg` is taken off its hit on the section."""
        return NO_CHANGE


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

    def build[M: Module](self, base: type[M], ref: ModuleRef) -> M:
        """The module for `ref`, with its params parsed; a bad reference fails loudly."""
        params = self.validate_params(base, ref.key, ref.params)
        return self.get(base, ref.key)(params)


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
