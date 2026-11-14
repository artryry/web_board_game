from app.engine.registry import FieldEffectModule, field_effect


@field_effect("free_move")
class FreeMove(FieldEffectModule):
    name = "Free move"
    description = (
        "Moving a creature doesn't use up its action: it can move once a turn at any time, even "
        "on the turn it is played or after it attacked."
    )

    def move_uses_action(self) -> bool:
        return False
