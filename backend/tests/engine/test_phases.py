"""The phase modules. Draw, Gain mana, the hand limit and the turn flow are in test_runner."""

from app.engine.actions import CreatureRef, EndPhase
from app.engine.events import AttackMade
from app.engine.registry import PhaseModule, registry
from app.engine.runner import start_game
from app.engine.state import GameState
from tests.engine.builders import (
    act,
    bare_rules,
    creature,
    filler_decks,
    new_game,
    put_creature,
    ref,
)

LANE_COMBAT_RULES = bare_rules(
    turn=[ref("gain_mana"), ref("action_phase"), ref("lane_combat"), ref("end_turn")]
)


def _lane_combat_game() -> GameState:
    return new_game(LANE_COMBAT_RULES)


def test_action_phase_reads_its_params() -> None:
    phase = registry.build(
        PhaseModule, ref("action_phase", actor="both", allow=["move"], time_limit_s=30)
    )

    assert phase.interactive
    assert phase.actor() == "both"
    assert phase.allowed() == frozenset({"move"})
    assert phase.time_limit_s() == 30


def test_automatic_phases_wait_for_no_one() -> None:
    for key in ("draw", "gain_mana", "lane_combat", "discard_to_hand_limit", "end_turn"):
        assert not registry.build(PhaseModule, ref(key)).interactive


def test_setup_runs_gain_mana_for_both_seats() -> None:
    state, _ = start_game(bare_rules(setup=[ref("gain_mana")]), filler_decks(), seed=1)

    # Setup gave both players their first mana; seat 0's turn-1 Gain mana then grew it.
    assert [(p.mana, p.max_mana) for p in state.players] == [(2, 2), (1, 1)]


def test_lane_combat_attacks_with_every_ready_creature_lane_by_lane() -> None:
    state = _lane_combat_game()
    first = put_creature(state, 0, 0, 0, creature("A", 5, 2))
    put_creature(state, 0, 0, 1, creature("Sleepy", 5, 2), ready=False)
    third = put_creature(state, 0, 2, 0, creature("C", 5, 3))
    put_creature(state, 1, 1, 0, creature("Idle", 5, 9))  # not the active seat: stays put

    state, events = act(state, 0, EndPhase())

    attackers = [event.uid for event in events if isinstance(event, AttackMade)]
    assert attackers == [first.uid, third.uid]
    assert [section.hp for section in state.sections[1]] == [18, 20, 17]


def test_lane_combat_hits_taunt_before_the_first_creature() -> None:
    state = _lane_combat_game()
    put_creature(state, 0, 0, 0, creature("A", 9, 1))
    put_creature(state, 1, 0, 0, creature("First", 5, 0))
    guard = put_creature(state, 1, 0, 2, creature("Guard", 5, 0, 1, ref("taunt")))

    state, events = act(state, 0, EndPhase())

    targets = [event.target for event in events if isinstance(event, AttackMade)]
    assert targets == [CreatureRef(uid=guard.uid)]


def test_lane_combat_stops_when_the_game_ends() -> None:
    state = new_game(
        bare_rules(
            board={"lanes": 2},
            turn=[ref("gain_mana"), ref("action_phase"), ref("lane_combat"), ref("end_turn")],
        )
    )
    for section in state.sections[1]:
        section.hp = 1
    first = put_creature(state, 0, 0, 0, creature("A", 2, 1))
    second = put_creature(state, 0, 1, 0, creature("B", 2, 1))
    put_creature(state, 0, 1, 1, creature("Late", 2, 1))

    state, events = act(state, 0, EndPhase())

    attackers = [event.uid for event in events if isinstance(event, AttackMade)]
    assert attackers == [first.uid, second.uid]
    assert (state.status, state.winner, state.turn_number) == ("finished", 0, 1)
