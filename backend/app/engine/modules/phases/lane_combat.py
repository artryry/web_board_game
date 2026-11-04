from app.engine.registry import PhaseModule, phase


@phase("lane_combat")
class LaneCombat(PhaseModule):
    name = "Lane combat"
    description = "Combat resolves automatically, lane by lane."
