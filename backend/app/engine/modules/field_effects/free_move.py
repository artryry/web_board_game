from app.engine.registry import FieldEffectModule, field_effect


@field_effect("free_move")
class FreeMove(FieldEffectModule):
    name = "Free move"
    description = "Moving a creature doesn't use up its action."
