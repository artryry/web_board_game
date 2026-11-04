from app.engine.registry import PhaseModule, phase


@phase("end_turn")
class EndTurn(PhaseModule):
    name = "End turn"
    description = "Ends the turn and passes it to the other player. It must be the last phase."
