from typing import Annotated, Literal

from pydantic import Field, field_validator

from app.engine.registry import ModuleParams, PhaseModule, phase

ActionKind = Literal["play", "move", "attack"]


@phase("action_phase")
class ActionPhase(PhaseModule):
    name = "Action phase"
    description = (
        "Players play cards, move creatures and attack, until they end the phase or the time "
        "runs out."
    )
    interactive = True

    class Params(ModuleParams):
        actor: Literal["active", "both"] = "active"
        allow: Annotated[
            list[ActionKind],
            Field(min_length=1, max_length=3, json_schema_extra={"uniqueItems": True}),
        ] = ["play", "move", "attack"]
        time_limit_s: Annotated[int, Field(ge=10, le=600, title="Time limit (s)")] = 90

        @field_validator("allow")
        @classmethod
        def _no_repeats(cls, value: list[ActionKind]) -> list[ActionKind]:
            if len(set(value)) != len(value):
                raise ValueError("actions must not repeat")
            return value
