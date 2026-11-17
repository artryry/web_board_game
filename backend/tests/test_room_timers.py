"""The turn timer (backend_plan §9.3): a phase ends at its deadline, for either actor, and the
deadline survives a restart."""

from contextlib import AsyncExitStack
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from redis.asyncio import Redis

from app.core.config import Settings
from app.engine.actions import EndPhase
from app.services.live_rooms import LiveRooms
from tests.helpers import AuthedUser, logged
from tests.room_helpers import (
    FakeClock,
    Socket,
    joined_socket,
    open_socket,
    restarted,
    start_game,
    table,
)

pytestmark = pytest.mark.usefixtures("rooms")


def _turn(actor: str, time_limit_s: int) -> list[dict[str, Any]]:
    return [
        {"key": "gain_mana", "params": {}},
        {"key": "draw", "params": {"count": 1}},
        {
            "key": "action_phase",
            "params": {
                "actor": actor,
                "allow": ["play", "move", "attack"],
                "time_limit_s": time_limit_s,
            },
        },
        {"key": "end_turn", "params": {}},
    ]


async def _change(socket: Socket) -> tuple[dict[str, Any], dict[str, Any]]:
    events = await socket.until("events")
    return events, await socket.expect("game_state")


async def test_the_active_players_phase_ends_at_its_deadline(
    ws_client: AsyncClient,
    rooms: LiveRooms,
    alice: AuthedUser,
    bob: AuthedUser,
    clock: FakeClock,
    logs: list[dict[str, Any]],
) -> None:
    tbl = await table(ws_client, alice, bob)

    async with AsyncExitStack() as stack:
        host = await joined_socket(stack, ws_client, tbl.code, alice)
        guest = await joined_socket(stack, ws_client, tbl.code, bob)
        await start_game(host, guest, tbl)
        room = rooms.peek(tbl.code)
        assert room is not None and room.state is not None and room.deadline is not None
        first_deadline = room.deadline
        assert first_deadline == clock.now_ms() + 90_000

        clock.advance(90)

        for socket in (host, guest):
            events, game_state = await _change(socket)
            assert events["seq"] is None
            assert (game_state["view"]["turn_number"], game_state["view"]["active_seat"]) == (2, 1)
            assert game_state["deadline"] == first_deadline + 90_000

    room = rooms.peek(tbl.code)
    assert room is not None and room.state is not None
    # The timer's end_phase is in the log as seat 0's own action, so a replay ends it too.
    assert (room.state.log[-1].seat, room.state.log[-1].action) == (0, EndPhase())
    (line,) = logged(logs, "timer.expired")
    assert (line["phase"], line["seats"]) == ("action_phase", [0])
    assert line["room_code"] == tbl.code


async def test_an_action_inside_a_phase_keeps_its_deadline(
    ws_client: AsyncClient, rooms: LiveRooms, alice: AuthedUser, bob: AuthedUser
) -> None:
    tbl = await table(ws_client, alice, bob)

    async with AsyncExitStack() as stack:
        host = await joined_socket(stack, ws_client, tbl.code, alice)
        guest = await joined_socket(stack, ws_client, tbl.code, bob)
        await start_game(host, guest, tbl)
        room = rooms.peek(tbl.code)
        assert room is not None and room.state is not None
        seat_0 = host if room.member_at(0) == room.host else guest
        game_state = await _first_game_state(seat_0)
        play = next(a for a in game_state["legal_actions"] if a["type"] == "play_card")

        await seat_0.action(play)

        _, after = await _change(seat_0)
        assert after["deadline"] == game_state["deadline"]


async def _first_game_state(socket: Socket) -> dict[str, Any]:
    await socket.send("resync")
    await socket.expect("room_state")
    return await socket.expect("game_state")


async def test_an_actor_both_phase_ends_for_the_seats_that_arent_ready(
    ws_client: AsyncClient,
    rooms: LiveRooms,
    alice: AuthedUser,
    bob: AuthedUser,
    clock: FakeClock,
    logs: list[dict[str, Any]],
) -> None:
    tbl = await table(ws_client, alice, bob, turn=_turn("both", 60))

    async with AsyncExitStack() as stack:
        host = await joined_socket(stack, ws_client, tbl.code, alice)
        guest = await joined_socket(stack, ws_client, tbl.code, bob)
        await start_game(host, guest, tbl)
        room = rooms.peek(tbl.code)
        assert room is not None
        seat_1 = guest if room.member_at(1) == room.guest else host
        await seat_1.action({"type": "end_phase"})
        await _change(host)
        await _change(guest)

        clock.advance(60)

        _, game_state = await _change(host)
        assert game_state["view"]["turn_number"] == 2

    room = rooms.peek(tbl.code)
    assert room is not None and room.state is not None
    (line,) = logged(logs, "timer.expired")
    assert line["seats"] == [0]
    assert [(entry.seat, entry.action) for entry in room.state.log] == [
        (1, EndPhase()),
        (0, EndPhase()),
    ]


async def test_an_actor_both_phase_ends_for_both_when_neither_is_ready(
    ws_client: AsyncClient,
    rooms: LiveRooms,
    alice: AuthedUser,
    bob: AuthedUser,
    clock: FakeClock,
) -> None:
    tbl = await table(ws_client, alice, bob, turn=_turn("both", 60))

    async with AsyncExitStack() as stack:
        host = await joined_socket(stack, ws_client, tbl.code, alice)
        guest = await joined_socket(stack, ws_client, tbl.code, bob)
        await start_game(host, guest, tbl)

        clock.advance(60)

        _, game_state = await _change(host)
        assert game_state["view"]["turn_number"] == 2

    room = rooms.peek(tbl.code)
    assert room is not None and room.state is not None
    assert [(entry.seat, entry.action) for entry in room.state.log] == [
        (0, EndPhase()),
        (1, EndPhase()),
    ]


@pytest.mark.parametrize("passed_during_restart", [False, True])
async def test_the_deadline_comes_back_after_a_restart(
    app: FastAPI,
    ws_client: AsyncClient,
    rooms: LiveRooms,
    redis: Redis,
    settings: Settings,
    alice: AuthedUser,
    bob: AuthedUser,
    clock: FakeClock,
    passed_during_restart: bool,
) -> None:
    # A deadline shorter than the 60 s a player may stay away, so the timer fires first.
    tbl = await table(ws_client, alice, bob, turn=_turn("active", 30))
    async with AsyncExitStack() as stack:
        host = await joined_socket(stack, ws_client, tbl.code, alice)
        guest = await joined_socket(stack, ws_client, tbl.code, bob)
        await start_game(host, guest, tbl)

    async with restarted(app, rooms, redis, settings, clock) as new_rooms:
        if passed_during_restart:
            # The deadline passes while no process holds the room: it fires on the load.
            clock.advance(30)
        async with open_socket(ws_client, tbl.code, alice) as host:
            await host.expect("room_state")
            await host.expect("game_state")
            if not passed_during_restart:
                clock.advance(30)

            _, game_state = await _change(host)
            assert game_state["view"]["turn_number"] == 2

        room = new_rooms.peek(tbl.code)
        assert room is not None and room.state is not None
        assert room.state.status == "playing"
