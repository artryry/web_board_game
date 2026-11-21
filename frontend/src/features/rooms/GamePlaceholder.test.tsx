import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { gameView } from "@/test/gameViewFixture";
import { renderApp, saveSession } from "@/test/renderApp";
import { closeRoomSocket, finishGame, sentOfType, updatePlayer } from "@/test/roomServer";
import { addRoom, BOB, findPlayer, ALICE, type FakeRoom } from "@/test/roomStore";
import type { Seat } from "@/ws/messages";

const CODE = "ABC234";

/** A room whose game is on, alice in `aliceSeat`. */
function playingRoom(aliceSeat: Seat = 0): FakeRoom {
  const room = addRoom({ code: CODE, guest: "bob", status: "playing" });
  for (const member of room.players) {
    member.connected = member.user_id === BOB.user_id;
    member.deckId = "a-deck";
    member.seat = member.user_id === ALICE.user_id ? aliceSeat : aliceSeat === 0 ? 1 : 0;
  }
  room.view = gameView({ seat: aliceSeat });
  return room;
}

async function openGame() {
  saveSession();
  const view = renderApp(`/room/${CODE}`);
  await screen.findByRole("heading", { name: "Game in progress" });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Surrender" })).toBeEnabled();
  });
  return view;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("GamePlaceholder", () => {
  it("says who plays first: seat 0", async () => {
    playingRoom(1);
    await openGame();
    expect(screen.getByText("bob plays first")).toBeInTheDocument();
  });

  it("surrenders after asking, and shows the result", async () => {
    playingRoom(0);
    const { user } = await openGame();
    await user.click(screen.getByRole("button", { name: "Surrender" }));
    const dialog = screen.getByRole("dialog", { name: "Surrender?" });
    expect(dialog).toHaveTextContent("bob wins.");
    await user.click(within(dialog).getByRole("button", { name: "Surrender" }));

    expect(await screen.findByRole("heading", { name: "You lost" })).toBeInTheDocument();
    expect(screen.getByText("You surrendered.")).toBeInTheDocument();
    expect(sentOfType("action").map((message) => message.payload)).toEqual([{ type: "surrender" }]);
    expect(screen.getByRole("link", { name: "Back to the dashboard" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("shows the result of a finished game after a reload, from the view", async () => {
    const room = playingRoom(0);
    finishGame(room, undefined, 0, "abandoned");
    saveSession();
    renderApp(`/room/${CODE}`);
    expect(await screen.findByRole("heading", { name: "You won" })).toBeInTheDocument();
    expect(screen.getByText("bob left the game.")).toBeInTheDocument();
  });

  it("counts down while the opponent is away, and stops when they're back", async () => {
    const now = new Date("2026-11-21T12:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now });
    playingRoom(0);
    await openGame();

    updatePlayer(CODE, BOB.user_id, { connected: false, away_since: now.getTime() - 18_000 });
    expect(await screen.findByText(/^bob left the game\. They lose in/)).toHaveTextContent(
      "bob left the game. They lose in 0:42 unless they come back.",
    );

    updatePlayer(CODE, BOB.user_id, { connected: true, away_since: null });
    await waitFor(() => {
      expect(screen.queryByText(/They lose in/)).not.toBeInTheDocument();
    });
  });

  it("asks before leaving the page during a game", async () => {
    playingRoom(0);
    const { user, router } = await openGame();
    await user.click(screen.getByRole("link", { name: "Decks" }));
    const dialog = screen.getByRole("dialog", { name: "Leave the game?" });
    expect(dialog).toHaveTextContent("You lose if you're away for 60 seconds.");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(router.state.location.pathname).toBe(`/room/${CODE}`);

    await user.click(screen.getByRole("link", { name: "Decks" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Leave the game?" })).getByRole("button", {
        name: "Leave",
      }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/decks");
    });
  });

  it("warns in the reconnecting banner that being away loses the game", async () => {
    playingRoom(0);
    await openGame();
    closeRoomSocket(CODE, 1011);
    expect(await screen.findByText(/^Reconnecting…/)).toHaveTextContent(
      "Reconnecting… You lose if you're away for 60 seconds.",
    );
    expect(screen.getByRole("button", { name: "Surrender" })).toBeDisabled();
  });

  it("asks nothing when leaving a finished game", async () => {
    const room = playingRoom(0);
    finishGame(room, undefined, 1, "conquered");
    saveSession();
    const { user, router } = renderApp(`/room/${CODE}`);
    expect(await screen.findByRole("heading", { name: "You lost" })).toBeInTheDocument();
    expect(findPlayer(room, ALICE.user_id)?.seat).toBe(0);
    await user.click(screen.getByRole("link", { name: "Back to the dashboard" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
  });
});
