"""The game socket before the game (backend_plan §9.2): logging in, close codes, and the lobby."""

from contextlib import AsyncExitStack
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from httpx_ws import AsyncWebSocketSession, aconnect_ws
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import create_access_token
from app.schemas.room import CloseCode
from tests.helpers import AuthedUser, create_card, create_deck, logged, register_user
from tests.room_helpers import (
    FakeClock,
    Table,
    create_room,
    eventually,
    join_room,
    joined_socket,
    open_socket,
    playable_deck,
    small_ruleset,
    start_game,
    table,
    token_of,
)

pytestmark = pytest.mark.usefixtures("rooms")


async def _players(socket_state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {player["username"]: player for player in socket_state["players"]}


# --- Logging in ---


async def test_a_member_gets_the_room_once_logged_in(
    ws_client: AsyncClient, alice: AuthedUser, logs: list[dict[str, Any]]
) -> None:
    code = await create_room(ws_client, alice, await small_ruleset(ws_client, alice))

    async with open_socket(ws_client, code, alice) as socket:
        state = await socket.expect("room_state")

    assert state["code"] == code
    assert state["players"][0]["connected"] is True
    (line,) = logged(logs, "ws.connected")
    assert (line["room_code"], line["user_id"]) == (code, str(alice.id))
    await eventually(lambda: logged(logs, "ws.closed"))
    (closed,) = logged(logs, "ws.closed")
    assert closed["code"] == 1000
    assert isinstance(closed["duration_ms"], int)


async def test_no_auth_in_time_closes_with_4401(
    ws_client: AsyncClient, alice: AuthedUser, clock: FakeClock, logs: list[dict[str, Any]]
) -> None:
    code = await create_room(ws_client, alice, await small_ruleset(ws_client, alice))

    async with open_socket(ws_client, code) as socket:
        await clock.wait_for_sleepers()
        clock.advance(10)
        assert await socket.close_code() == CloseCode.AUTH_FAILED

    (line,) = logged(logs, "ws.auth_failed")
    assert (line["code"], line["reason"]) == (4401, "timeout")


@pytest.mark.parametrize(
    ("first_message", "reason"),
    [
        ({"type": "auth", "seq": 1, "payload": {"token": "not-a-token"}}, "token_invalid"),
        ({"type": "ping", "seq": 1, "payload": {}}, "bad_message"),
        ({"type": "auth", "seq": 1}, "bad_message"),
    ],
)
async def test_a_bad_first_message_closes_with_4401(
    ws_client: AsyncClient,
    alice: AuthedUser,
    logs: list[dict[str, Any]],
    first_message: dict[str, Any],
    reason: str,
) -> None:
    code = await create_room(ws_client, alice, await small_ruleset(ws_client, alice))

    async with open_socket(ws_client, code) as socket:
        await socket.ws.send_json(first_message)
        assert await socket.close_code() == CloseCode.AUTH_FAILED

    (line,) = logged(logs, "ws.auth_failed")
    assert line["reason"] == reason


async def test_an_expired_token_closes_with_4401(
    ws_client: AsyncClient, alice: AuthedUser, settings: Settings, logs: list[dict[str, Any]]
) -> None:
    code = await create_room(ws_client, alice, await small_ruleset(ws_client, alice))
    expired = create_access_token(alice.id, settings, now=datetime.now(UTC) - timedelta(hours=1))

    async with open_socket(ws_client, code) as socket:
        await socket.send("auth", {"token": expired})
        assert await socket.close_code() == CloseCode.AUTH_FAILED

    (line,) = logged(logs, "ws.auth_failed")
    assert line["reason"] == "token_expired"


async def test_a_deleted_users_token_closes_with_4401(
    ws_client: AsyncClient, alice: AuthedUser, bob: AuthedUser, db: AsyncSession
) -> None:
    code = await create_room(ws_client, alice, await small_ruleset(ws_client, alice))
    await join_room(ws_client, bob, code)
    await db.execute(text("DELETE FROM users WHERE id = :id"), {"id": bob.id})

    async with open_socket(ws_client, code, bob) as socket:
        assert await socket.close_code() == CloseCode.AUTH_FAILED


async def test_a_non_member_closes_with_4403(
    ws_client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    code = await create_room(ws_client, alice, await small_ruleset(ws_client, alice))

    async with open_socket(ws_client, code, bob) as socket:
        assert await socket.close_code() == CloseCode.NOT_MEMBER


async def test_an_unknown_room_closes_with_4404(ws_client: AsyncClient, alice: AuthedUser) -> None:
    async with open_socket(ws_client, "ZZZZZZ", alice) as socket:
        assert await socket.close_code() == CloseCode.ROOM_NOT_FOUND


async def test_the_token_is_never_logged(
    ws_client: AsyncClient, alice: AuthedUser, logs: list[dict[str, Any]]
) -> None:
    code = await create_room(ws_client, alice, await small_ruleset(ws_client, alice))

    async with open_socket(ws_client, code, alice) as socket:
        await socket.expect("room_state")
        await socket.send("auth", {"token": token_of(alice)})
        await socket.expect("error")

    assert token_of(alice) not in repr(logs)


async def test_a_newer_socket_replaces_the_older_one(
    ws_client: AsyncClient, alice: AuthedUser
) -> None:
    code = await create_room(ws_client, alice, await small_ruleset(ws_client, alice))

    async with AsyncExitStack() as stack:
        first = await joined_socket(stack, ws_client, code, alice)
        second = await joined_socket(stack, ws_client, code, alice)

        assert await first.close_code() == CloseCode.REPLACED
        assert await second.nothing_pending()
        response = await ws_client.get(f"/api/rooms/{code}", headers=alice.headers)
        assert response.json()["players"][0]["connected"] is True


# --- Messages ---


async def test_ping_resync_and_bad_messages(ws_client: AsyncClient, alice: AuthedUser) -> None:
    code = await create_room(ws_client, alice, await small_ruleset(ws_client, alice))

    async with AsyncExitStack() as stack:
        socket = await joined_socket(stack, ws_client, code, alice)

        await socket.send("ping")
        assert (await socket.receive())["type"] == "pong"

        seq = await socket.send("resync")
        assert (await socket.expect("room_state"))["code"] == code

        seq = await socket.send("no_such_type")
        assert (await socket.expect("error"))["seq"] == seq

        await socket.ws.send_text("not json")
        error = await socket.expect("error")
        assert (error["seq"], error["reason"]) == (None, "bad_message")

        await socket.ws.send_bytes(b"\x00")
        assert (await socket.expect("error"))["reason"] == "bad_message"

        seq = await socket.send("auth", {"token": token_of(alice)})
        error = await socket.expect("error")
        assert (error["seq"], error["reason"]) == (seq, "bad_message")

        seq = await socket.action({"type": "end_phase"})
        error = await socket.expect("error")
        assert (error["seq"], error["reason"]) == (seq, "not_in_game")

        # Players can't send the server's own action.
        await socket.action({"type": "abandon"})
        assert (await socket.expect("error"))["reason"] == "bad_message"


# --- The lobby ---


async def test_a_join_tells_the_hosts_socket(
    ws_client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    code = await create_room(ws_client, alice, await small_ruleset(ws_client, alice))

    async with AsyncExitStack() as stack:
        host = await joined_socket(stack, ws_client, code, alice)
        await join_room(ws_client, bob, code)

        players = await _players(await host.expect("room_state"))
        assert players["bob"]["connected"] is False


async def test_selecting_a_deck_shows_it_only_to_its_owner(
    ws_client: AsyncClient, alice: AuthedUser, bob: AuthedUser, logs: list[dict[str, Any]]
) -> None:
    tbl = await table(ws_client, alice, bob)

    async with AsyncExitStack() as stack:
        host = await joined_socket(stack, ws_client, tbl.code, alice)
        guest = await joined_socket(stack, ws_client, tbl.code, bob)
        await host.expect("room_state")  # bob connected

        await guest.send("select_deck", {"deck_id": tbl.guest_deck})

        mine = await guest.expect("room_state")
        assert mine["my_deck"] == {
            "id": tbl.guest_deck,
            "name": "Bears",
            "origin_id": mine["my_deck"]["origin_id"],
            "card_count": 10,
        }
        theirs = await host.expect("room_state")
        assert theirs["my_deck"] is None
        assert (await _players(theirs))["bob"]["has_deck"] is True
    assert logged(logs, "room.deck_selected")


async def test_a_deck_that_isnt_yours_or_doesnt_fit_is_refused(
    ws_client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    tbl = await table(ws_client, alice, bob)
    card = await create_card(ws_client, bob, name="Lone")
    small = await create_deck(ws_client, bob, [(card, 3)], name="Small")

    async with AsyncExitStack() as stack:
        guest = await joined_socket(stack, ws_client, tbl.code, bob)

        seq = await guest.send("select_deck", {"deck_id": tbl.host_deck})
        error = await guest.expect("error")
        assert (error["seq"], error["reason"]) == (seq, "deck_not_found")

        await guest.send("select_deck", {"deck_id": small["id"]})
        error = await guest.expect("error")
        assert error["reason"] == "deck_not_playable"
        assert [problem["kind"] for problem in error["problems"]] == ["size", "copies"]
        assert await guest.nothing_pending()


async def test_ready_needs_a_deck_and_a_new_deck_clears_it(
    ws_client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    tbl = await table(ws_client, alice, bob)
    other_deck = await playable_deck(ws_client, bob, "Owls")

    async with AsyncExitStack() as stack:
        guest = await joined_socket(stack, ws_client, tbl.code, bob)

        await guest.send("ready", {"ready": True})
        assert (await guest.expect("error"))["reason"] == "no_deck"

        await guest.send("select_deck", {"deck_id": tbl.guest_deck})
        await guest.expect("room_state")
        await guest.send("ready", {"ready": True})
        assert (await _players(await guest.expect("room_state")))["bob"]["ready"] is True
        await guest.send("ready", {"ready": False})
        assert (await _players(await guest.expect("room_state")))["bob"]["ready"] is False

        await guest.send("ready", {"ready": True})
        await guest.expect("room_state")
        await guest.send("select_deck", {"deck_id": other_deck})
        state = await guest.expect("room_state")
        assert (await _players(state))["bob"]["ready"] is False
        assert state["my_deck"]["name"] == "Owls"


async def test_a_lobby_disconnect_clears_ready(
    ws_client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    tbl = await table(ws_client, alice, bob)

    async with AsyncExitStack() as stack:
        host = await joined_socket(stack, ws_client, tbl.code, alice)
        async with open_socket(ws_client, tbl.code, bob) as guest:
            await guest.expect("room_state")
            await guest.send("select_deck", {"deck_id": tbl.guest_deck})
            await guest.send("ready", {"ready": True})
            await guest.until("room_state")
            await guest.until("room_state")

        state = await host.until("room_state")
        while (await _players(state))["bob"]["connected"]:
            state = await host.until("room_state")
        assert (await _players(state))["bob"]["ready"] is False


async def test_the_guest_leaving_frees_the_seat(
    ws_client: AsyncClient, alice: AuthedUser, bob: AuthedUser, logs: list[dict[str, Any]]
) -> None:
    tbl = await table(ws_client, alice, bob)

    async with AsyncExitStack() as stack:
        host = await joined_socket(stack, ws_client, tbl.code, alice)
        guest = await joined_socket(stack, ws_client, tbl.code, bob)
        await host.expect("room_state")

        await guest.send("leave")

        assert await guest.close_code() == CloseCode.NORMAL
        state = await host.expect("room_state")
        assert [player["username"] for player in state["players"]] == ["alice"]

    carol = await register_user(ws_client, "carol")
    assert len((await join_room(ws_client, carol, tbl.code))["players"]) == 2
    (line,) = logged(logs, "room.left")
    assert line["host"] is False


async def test_the_host_leaving_closes_the_room(
    ws_client: AsyncClient, alice: AuthedUser, bob: AuthedUser, redis: Redis
) -> None:
    tbl = await table(ws_client, alice, bob)

    async with AsyncExitStack() as stack:
        host = await joined_socket(stack, ws_client, tbl.code, alice)
        guest = await joined_socket(stack, ws_client, tbl.code, bob)

        await host.send("leave")

        assert (await guest.until("room_closed")) is None
        assert await guest.close_code() == CloseCode.NORMAL
        assert await host.close_code() == CloseCode.NORMAL

    assert await redis.exists(f"room:{tbl.code}") == 0
    response = await ws_client.get(f"/api/rooms/{tbl.code}", headers=bob.headers)
    assert response.status_code == 404


async def test_lobby_messages_are_refused_once_the_game_starts(
    ws_client: AsyncClient, alice: AuthedUser, bob: AuthedUser
) -> None:
    tbl: Table = await table(ws_client, alice, bob)

    async with AsyncExitStack() as stack:
        host = await joined_socket(stack, ws_client, tbl.code, alice)
        guest = await joined_socket(stack, ws_client, tbl.code, bob)
        await start_game(host, guest, tbl)

        lobby_messages: list[tuple[str, dict[str, Any]]] = [
            ("select_deck", {"deck_id": tbl.host_deck}),
            ("ready", {"ready": False}),
            ("leave", {}),
        ]
        for message_type, payload in lobby_messages:
            await host.send(message_type, payload)
            assert (await host.until("error"))["reason"] == "not_in_lobby"


async def test_the_socket_path_can_be_lower_case(ws_client: AsyncClient, alice: AuthedUser) -> None:
    code = await create_room(ws_client, alice, await small_ruleset(ws_client, alice))

    url = f"http://test/ws/rooms/{code.lower()}"
    async with aconnect_ws(url, ws_client, session_class=AsyncWebSocketSession) as ws:
        await ws.send_json({"type": "auth", "seq": 1, "payload": {"token": token_of(alice)}})
        message = await ws.receive_json(timeout=5)

    assert (message["type"], message["payload"]["code"]) == ("room_state", code)
