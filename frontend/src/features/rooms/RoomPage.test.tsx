import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { lastBody } from "@/test/contentStore";
import { gameView } from "@/test/gameViewFixture";
import { TEST_USER } from "@/test/handlers";
import { renderApp, saveSession } from "@/test/renderApp";
import {
  closeRoomByHost,
  closeRoomSocket,
  finishGame,
  isConnected,
  sendToRoom,
  sentOfType,
} from "@/test/roomServer";
import { addRoom, roomStore } from "@/test/roomStore";

import { LAST_ROOM_KEY, lastRoomFor } from "./lastRoom";

const CODE = "ABC234";

/** Opens the room page and waits until its socket has the room. */
async function openRoom(path = `/room/${CODE}`) {
  saveSession();
  const view = renderApp(path);
  await screen.findByRole("heading", { name: `Room ${CODE}` });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /^(Leave|Close room)$/ })).toBeEnabled();
  });
  return view;
}

describe("RoomPage", () => {
  it("joins on load, opens the socket and remembers the room", async () => {
    addRoom({ code: CODE });
    await openRoom();
    expect(lastBody("POST", "/api/rooms/join")).toEqual({ code: CODE });
    expect(isConnected(CODE)).toBe(true);
    expect(sentOfType("auth")).toHaveLength(1);
    expect(lastRoomFor(TEST_USER.id)).toBe(CODE);
  });

  it("joins by the link as the guest", async () => {
    addRoom({ code: CODE, host: "bob" });
    await openRoom();
    const players = screen.getByRole("list", { name: "Players" });
    expect(within(players).getByRole("listitem", { name: "bob" })).toHaveTextContent("(host)");
    expect(within(players).getByRole("listitem", { name: "alice" })).toHaveTextContent("(you)");
  });

  it("puts the room's own code in the address for a code typed in lower case", async () => {
    addRoom({ code: CODE });
    const { router } = await openRoom("/room/abc234");
    expect(router.state.location.pathname).toBe(`/room/${CODE}`);
    expect(sentOfType("auth")).toHaveLength(1);
  });

  it.each([
    [
      "no room has the code",
      () => undefined,
      "This room is gone: the code is wrong, or the room closed.",
    ],
    [
      "the room is full",
      () => addRoom({ code: CODE, host: "bob", status: "playing" }),
      "This room is full, or its game has started.",
    ],
  ])("says when %s, with a way back", async (_label, setUp, text) => {
    setUp();
    saveSession();
    renderApp(`/room/${CODE}`);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the dashboard" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("shows Reconnecting… and turns the controls off while the socket is away", async () => {
    addRoom({ code: CODE });
    await openRoom();
    // The socket comes back after 1 s (RoomSocket's tests check the timing); the page is checked
    // before that.
    closeRoomSocket(CODE, 1011);
    const banner = await screen.findByText(/^Reconnecting…/);
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).not.toHaveTextContent("60 seconds");
    expect(screen.getByRole("button", { name: "Close room" })).toBeDisabled();
  });

  it.each([
    [4403, "You're not in this room any more."],
    [4404, "This room is gone."],
  ])("ends on %i with its message, and forgets the room", async (code, text) => {
    addRoom({ code: CODE });
    await openRoom();
    closeRoomSocket(CODE, code);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the dashboard" })).toBeInTheDocument();
    expect(localStorage.getItem(LAST_ROOM_KEY)).toBeNull();
  });

  it("says another tab took the room, and takes it back with Use it here", async () => {
    addRoom({ code: CODE });
    const { user } = await openRoom();
    closeRoomSocket(CODE, 4409);
    expect(await screen.findByText("This room is open in another tab.")).toBeInTheDocument();
    expect(lastRoomFor(TEST_USER.id)).toBe(CODE);

    await user.click(screen.getByRole("button", { name: "Use it here" }));
    expect(await screen.findByRole("heading", { name: `Room ${CODE}` })).toBeInTheDocument();
    await waitFor(() => {
      expect(isConnected(CODE)).toBe(true);
    });
    expect(sentOfType("auth")).toHaveLength(2);
  });

  it("says when it can't sign in to the room, and tries again on request", async () => {
    addRoom({ code: CODE });
    roomStore.refusals = [4401, 4401];
    saveSession();
    const { user } = renderApp(`/room/${CODE}`);
    expect(await screen.findByText("Couldn't sign in to the room.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close room" })).toBeEnabled();
    });
  });

  it("says a finished room has closed", async () => {
    const room = addRoom({ code: CODE, guest: "bob", status: "playing" });
    for (const [seat, member] of room.players.entries()) member.seat = seat === 0 ? 0 : 1;
    room.view = gameView({ seat: 0 });
    finishGame(room, undefined, 1, "surrender");
    saveSession();
    renderApp(`/room/${CODE}`);
    await screen.findByRole("heading", { name: "You lost" });
    await waitFor(() => {
      expect(isConnected(CODE)).toBe(true);
    });

    sendToRoom(CODE, { type: "room_closed", payload: null });
    closeRoomSocket(CODE, 1000);
    expect(await screen.findByText("This room has closed.")).toBeInTheDocument();
  });

  it("tells the guest the host closed the room, and forgets it", async () => {
    addRoom({ code: CODE, host: "bob" });
    await openRoom();
    closeRoomByHost(CODE);
    expect(await screen.findByText("The host closed the room.")).toBeInTheDocument();
    expect(localStorage.getItem(LAST_ROOM_KEY)).toBeNull();
  });
});
