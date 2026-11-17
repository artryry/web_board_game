"""Players away from a game (backend_plan §9.3): back in time, or out with `abandoned`."""

from contextlib import AsyncExitStack
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from redis.asyncio import Redis

from app.core.config import Settings
from app.engine.actions import Abandon
from app.services.live_rooms import LiveRooms
from tests.helpers import AuthedUser, logged
from tests.room_helpers import (
    FakeClock,
    Socket,
    Table,
    eventually,
    joined_socket,
    open_socket,
    restarted,
    start_game,
    table,
)

pytestmark = pytest.mark.usefixtures("rooms")


def _guest_of(state: dict[str, Any]) -> dict[str, Any]:
    guest: dict[str, Any] = next(p for p in state["players"] if not p["is_host"])
    return guest


def _seat_of(rooms: LiveRooms, code: str, user: AuthedUser) -> int:
    room = rooms.peek(code)
    assert room is not None
    member = room.member(user.id)
    assert member is not None and member.seat is not None
    return member.seat


async def _game(
    ws_client: AsyncClient, alice: AuthedUser, bob: AuthedUser, stack: AsyncExitStack
) -> tuple[Table, Socket]:
    """A started game; the host's socket stays open in `stack`, the guest's is closed."""
    tbl = await table(ws_client, alice, bob)
    host = await joined_socket(stack, ws_client, tbl.code, alice)
    async with open_socket(ws_client, tbl.code, bob) as guest:
        await guest.expect("room_state")
        await start_game(host, guest, tbl)
    return tbl, host


async def test_a_player_who_comes_back_in_time_plays_on(
    ws_client: AsyncClient,
    alice: AuthedUser,
    bob: AuthedUser,
    clock: FakeClock,
    logs: list[dict[str, Any]],
) -> None:
    async with AsyncExitStack() as stack:
        tbl, host = await _game(ws_client, alice, bob, stack)
        away = await host.until("room_state")
        assert (_guest_of(away)["connected"], _guest_of(away)["away_since"]) == (
            False,
            clock.now_ms(),
        )

        clock.advance(59)
        async with open_socket(ws_client, tbl.code, bob) as guest:
            assert _guest_of(await guest.expect("room_state"))["away_since"] is None
            await guest.expect("game_state")
            back = await host.until("room_state")
            assert _guest_of(back)["away_since"] is None
            assert _guest_of(back)["connected"] is True

            clock.advance(10)
            assert await host.nothing_pending()

    assert logged(logs, "game.player_away")[0]["user_id"] == bob.id
    assert logged(logs, "game.player_back")[0]["user_id"] == bob.id


async def test_a_player_away_for_60_seconds_loses_with_abandoned(
    ws_client: AsyncClient,
    rooms: LiveRooms,
    alice: AuthedUser,
    bob: AuthedUser,
    clock: FakeClock,
    logs: list[dict[str, Any]],
) -> None:
    async with AsyncExitStack() as stack:
        tbl, host = await _game(ws_client, alice, bob, stack)
        await host.until("room_state")  # bob is away

        clock.advance(60)

        events = await host.until("events")
        assert events["events"][-1] == {
            "type": "game_over",
            "winner": _seat_of(rooms, tbl.code, alice),
            "end_reason": "abandoned",
        }
        game_over = await host.until("game_over")
        assert game_over == {"winner": _seat_of(rooms, tbl.code, alice), "reason": "abandoned"}

    room = rooms.peek(tbl.code)
    assert room is not None and room.state is not None
    # In the log as bob's action, so a replay ends the same way.
    assert (room.state.log[-1].seat, room.state.log[-1].action) == (
        _seat_of(rooms, tbl.code, bob),
        Abandon(),
    )
    (ended,) = logged(logs, "game.ended")
    assert ended["end_reason"] == "abandoned"


async def test_when_both_are_away_the_first_to_reach_60_seconds_loses(
    ws_client: AsyncClient,
    rooms: LiveRooms,
    alice: AuthedUser,
    bob: AuthedUser,
    clock: FakeClock,
) -> None:
    async with AsyncExitStack() as stack:
        tbl, host = await _game(ws_client, alice, bob, stack)
        await host.until("room_state")
        clock.advance(10)
    # Both sockets are closed now: bob since 0 s, alice since 10 s.

    clock.advance(50)

    def finished() -> bool:
        room = rooms.peek(tbl.code)
        return room is not None and room.status == "finished"

    await eventually(finished)
    room = rooms.peek(tbl.code)
    assert room is not None and room.state is not None
    assert (room.state.winner, room.state.end_reason) == (
        _seat_of(rooms, tbl.code, alice),
        "abandoned",
    )


async def test_after_a_restart_an_absent_player_is_away_from_the_load(
    app: FastAPI,
    ws_client: AsyncClient,
    rooms: LiveRooms,
    redis: Redis,
    settings: Settings,
    alice: AuthedUser,
    bob: AuthedUser,
    clock: FakeClock,
    logs: list[dict[str, Any]],
) -> None:
    async with AsyncExitStack() as stack:
        tbl, host = await _game(ws_client, alice, bob, stack)
        await host.until("room_state")  # bob is away since 0 s
        clock.advance(50)

    async with restarted(app, rooms, redis, settings, clock) as new_rooms:
        async with open_socket(ws_client, tbl.code, alice) as host:
            state = await host.expect("room_state")
            await host.expect("game_state")
            # Time the server was down doesn't count: bob is away from the load, at 50 s.
            state = await host.until("room_state")
            assert _guest_of(state)["away_since"] == clock.now_ms()

            clock.advance(15)  # 65 s after bob left, 15 s after the load
            assert await host.nothing_pending()

            clock.advance(45)  # 60 s after the load
            game_over = await host.until("game_over")
            assert game_over["reason"] == "abandoned"
            assert game_over["winner"] == _seat_of(new_rooms, tbl.code, alice)

    restart_lines = [line for line in logged(logs, "game.player_away") if line["after_restart"]]
    assert [line["user_id"] for line in restart_lines] == [bob.id]
