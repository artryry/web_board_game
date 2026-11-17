"""A game over the socket (backend_plan §9.3): the start, actions, events, the end."""

import json
from contextlib import AsyncExitStack
from typing import Any

import pytest
from httpx import AsyncClient
from redis.asyncio import Redis

from app.core.config import Settings
from app.engine.seats import SEATS, Seat
from app.schemas.room import CloseCode
from app.services.live_rooms import LiveRooms
from app.services.room_store import RoomStore
from tests.engine.builders import acting_seat, greedy_action
from tests.helpers import AuthedUser, logged
from tests.room_helpers import FakeClock, Socket, joined_socket, start_game, table

pytestmark = pytest.mark.usefixtures("rooms")


class Game:
    """Both sockets of a started game, by seat, with the last game state each one got."""

    def __init__(
        self, rooms: LiveRooms, code: str, host: Socket, sockets: dict[Seat, Socket]
    ) -> None:
        self.rooms = rooms
        self.code = code
        self.host = host
        self.sockets = sockets
        self.game_states: dict[Seat, dict[str, Any]] = {}

    @classmethod
    async def start(
        cls, rooms: LiveRooms, code: str, host: Socket, guest: Socket, host_user: AuthedUser
    ) -> "Game":
        room = rooms.peek(code)
        assert room is not None and room.status == "playing"
        host_member = room.member(host_user.id)
        assert host_member is not None and host_member.seat is not None
        sockets: dict[Seat, Socket] = (
            {0: host, 1: guest} if host_member.seat == 0 else {0: guest, 1: host}
        )
        return cls(rooms, code, host, sockets)

    def state(self) -> Any:
        room = self.rooms.peek(self.code)
        assert room is not None and room.state is not None
        return room.state

    async def read_change(self, seat: Seat) -> tuple[dict[str, Any], dict[str, Any]]:
        """The events and the game state a change sent to `seat`."""
        socket = self.sockets[seat]
        events = await socket.until("events")
        game_state = await socket.expect("game_state")
        self.game_states[seat] = game_state
        return events, game_state


async def _started_game(
    ws_client: AsyncClient,
    rooms: LiveRooms,
    alice: AuthedUser,
    bob: AuthedUser,
    stack: Any,
    strong_host: bool = False,
) -> Game:
    tbl = await table(ws_client, alice, bob, strong_host=strong_host)
    host = await joined_socket(stack, ws_client, tbl.code, alice)
    guest = await joined_socket(stack, ws_client, tbl.code, bob)
    await start_game(host, guest, tbl)
    return await Game.start(rooms, tbl.code, host, guest, alice)


async def test_two_clients_play_a_full_game_to_a_win(
    ws_client: AsyncClient,
    rooms: LiveRooms,
    alice: AuthedUser,
    bob: AuthedUser,
    redis: Redis,
    logs: list[dict[str, Any]],
) -> None:
    async with AsyncExitStack() as stack:
        game = await _started_game(ws_client, rooms, alice, bob, stack, strong_host=True)
        game_over: dict[Seat, dict[str, Any]] = {}

        for _ in range(500):
            state = game.state()
            seat = acting_seat(state)
            if seat is None:
                break
            action = greedy_action(state, seat).model_dump(mode="json")
            # What the bot picks on the server's state is one of the moves the client was
            # offered: the client only ever sends those.
            if seat in game.game_states:
                assert action in game.game_states[seat]["legal_actions"]
            seq = await game.sockets[seat].action(action)

            for receiver in SEATS:
                events, _ = await game.read_change(receiver)
                assert events["seq"] == (seq if receiver == seat else None)
            if game.state().status == "finished":
                for receiver in SEATS:
                    game_over[receiver] = await game.sockets[receiver].expect("game_over")

        state = game.state()
        assert state.status == "finished"
        host_seat = next(seat for seat, socket in game.sockets.items() if socket is game.host)
        assert game_over[0] == game_over[1] == {"winner": host_seat, "reason": "conquered"}
        for receiver in SEATS:
            room_state = await game.sockets[receiver].expect("room_state")
            assert room_state["status"] == "finished"
            assert game.game_states[receiver]["view"]["status"] == "finished"
            assert game.game_states[receiver]["deadline"] is None

    # A finished room stays 10 minutes.
    assert 0 < await redis.ttl(f"room:{game.code}") <= 600
    (started,) = logged(logs, "game.started")
    (ended,) = logged(logs, "game.ended")
    assert started["game_id"] == ended["game_id"]
    assert (ended["end_reason"], ended["winner"]) == ("conquered", state.winner)
    assert ended["actions"] == len(state.log)


async def test_the_start_sends_the_room_events_and_game_state(
    ws_client: AsyncClient, rooms: LiveRooms, alice: AuthedUser, bob: AuthedUser
) -> None:
    tbl = await table(ws_client, alice, bob)

    async with AsyncExitStack() as stack:
        host = await joined_socket(stack, ws_client, tbl.code, alice)
        guest = await joined_socket(stack, ws_client, tbl.code, bob)
        await host.send("select_deck", {"deck_id": tbl.host_deck})
        await guest.send("select_deck", {"deck_id": tbl.guest_deck})
        await host.send("ready", {"ready": True})
        seq = await guest.send("ready", {"ready": True})

        for socket, is_starter in ((host, False), (guest, True)):
            room_state = await socket.until("room_state")
            while room_state["status"] != "playing":
                room_state = await socket.until("room_state")
            seats = sorted(player["seat"] for player in room_state["players"])
            assert seats == [0, 1]
            events = await socket.expect("events")
            assert events["seq"] == (seq if is_starter else None)
            assert events["events"][0] == {"type": "game_started"}
            game_state = await socket.expect("game_state")
            assert game_state["view"]["turn_number"] == 1
            assert game_state["deadline"] == game_state["server_time"] + 90_000


async def test_each_player_sees_only_their_own_cards(
    ws_client: AsyncClient, rooms: LiveRooms, alice: AuthedUser, bob: AuthedUser
) -> None:
    async with AsyncExitStack() as stack:
        game = await _started_game(ws_client, rooms, alice, bob, stack)
        await game.sockets[0].send("resync")
        await game.sockets[0].expect("room_state")
        view = (await game.sockets[0].expect("game_state"))["view"]

        own, other = view["players"]
        assert own["hand"] is not None and len(own["hand"]) == own["hand_count"]
        assert other["hand"] is None

        # Seat 0 ends its turn; seat 1's draw is hidden from seat 0.
        await game.sockets[0].action({"type": "end_phase"})
        events, _ = await game.read_change(0)
        their_events, _ = await game.read_change(1)
        drawn = [event for event in events["events"] if event["type"] == "card_drawn"]
        assert drawn and all(event["card"] is None for event in drawn)
        their_drawn = [e for e in their_events["events"] if e["type"] == "card_drawn"]
        assert all(event["card"] is not None for event in their_drawn)


async def test_an_illegal_action_is_refused_and_changes_nothing(
    ws_client: AsyncClient,
    rooms: LiveRooms,
    alice: AuthedUser,
    bob: AuthedUser,
    logs: list[dict[str, Any]],
) -> None:
    async with AsyncExitStack() as stack:
        game = await _started_game(ws_client, rooms, alice, bob, stack)
        version = game.state().version

        seq = await game.sockets[1].action({"type": "end_phase"})

        error = await game.sockets[1].expect("error")
        assert (error["seq"], error["reason"]) == (seq, "not_your_turn")
        assert game.state().version == version
        assert await game.sockets[0].nothing_pending()
    (line,) = logged(logs, "game.action_rejected")
    assert (line["reason"], line["type"]) == ("not_your_turn", "end_phase")


async def test_surrender_ends_the_game_for_the_other_player(
    ws_client: AsyncClient, rooms: LiveRooms, alice: AuthedUser, bob: AuthedUser
) -> None:
    async with AsyncExitStack() as stack:
        game = await _started_game(ws_client, rooms, alice, bob, stack)

        # Either player may surrender at any time, not only on their turn.
        await game.sockets[1].action({"type": "surrender"})

        for seat in SEATS:
            await game.read_change(seat)
            assert await game.sockets[seat].expect("game_over") == {
                "winner": 0,
                "reason": "surrender",
            }
        await game.sockets[1].action({"type": "end_phase"})
        assert (await game.sockets[1].until("error"))["reason"] == "game_over"


async def test_a_finished_room_closes_its_sockets_when_it_expires(
    ws_client: AsyncClient, rooms: LiveRooms, alice: AuthedUser, bob: AuthedUser, clock: FakeClock
) -> None:
    async with AsyncExitStack() as stack:
        game = await _started_game(ws_client, rooms, alice, bob, stack)
        await game.sockets[0].action({"type": "surrender"})
        for seat in SEATS:
            await game.sockets[seat].until("game_over")

        clock.advance(10 * 60)

        for seat in SEATS:
            assert await game.sockets[seat].until("room_closed") is None
            assert await game.sockets[seat].close_code() == CloseCode.NORMAL


async def test_a_write_that_loses_to_another_instance_gets_stale_state(
    ws_client: AsyncClient,
    rooms: LiveRooms,
    alice: AuthedUser,
    bob: AuthedUser,
    redis: Redis,
    settings: Settings,
) -> None:
    async with AsyncExitStack() as stack:
        game = await _started_game(ws_client, rooms, alice, bob, stack)
        # Another instance (during a deploy) writes the room first.
        other = RoomStore(redis, settings)
        stored = await other.load(game.code)
        assert stored is not None
        await other.save(stored)

        seq = await game.sockets[0].action({"type": "end_phase"})

        # Both players get the fresh state; the action isn't applied.
        for seat in SEATS:
            await game.sockets[seat].expect("room_state")
            assert (await game.sockets[seat].expect("game_state"))["view"]["turn_number"] == 1
        error = await game.sockets[0].expect("error")
        assert (error["seq"], error["reason"]) == (seq, "stale_state")

        # The cache is fresh again, so the next try goes through.
        await game.sockets[0].action({"type": "end_phase"})
        _, game_state = await game.read_change(0)
        assert game_state["view"]["turn_number"] == 2


async def test_no_message_carries_the_seed_or_the_decks(
    ws_client: AsyncClient, rooms: LiveRooms, alice: AuthedUser, bob: AuthedUser
) -> None:
    async with AsyncExitStack() as stack:
        game = await _started_game(ws_client, rooms, alice, bob, stack)
        await game.sockets[0].send("resync")
        messages = [await game.sockets[0].receive(), await game.sockets[0].receive()]

        text = json.dumps(messages)
        assert "seed" not in text
        assert "rng_state" not in text
        assert str(game.state().seed) not in text
        # The view counts both decks; it never lists them.
        players = messages[1]["payload"]["view"]["players"]
        assert all("deck" not in player for player in players)
