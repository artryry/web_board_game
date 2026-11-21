import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TEST_USER } from "@/test/handlers";
import { logged } from "@/test/logCapture";
import { renderApp, saveSession } from "@/test/renderApp";
import { sendToRoom, sentOfType, updatePlayer, updateRoom } from "@/test/roomServer";
import { addRoom, addRoomDeck, BOB, roomStore, seatGuest } from "@/test/roomStore";

import { LAST_ROOM_KEY } from "./lastRoom";

const CODE = "ABC234";

async function openLobby() {
  saveSession();
  const view = renderApp(`/room/${CODE}`);
  await screen.findByRole("heading", { name: `Room ${CODE}` });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /^(Leave|Close room)$/ })).toBeEnabled();
  });
  return view;
}

function slot(name: string) {
  return within(screen.getByRole("list", { name: "Players" })).getByRole("listitem", { name });
}

function deckOption(name: string) {
  return screen.getByRole("radio", { name: new RegExp(`^${name}`) });
}

describe("The lobby's players", () => {
  it("shows both seats, host first, with online, deck and ready", async () => {
    addRoom({ code: CODE });
    await openLobby();
    expect(slot("alice")).toHaveTextContent("alice (host, you)");
    expect(slot("alice")).toHaveTextContent("Online");
    expect(slot("alice")).toHaveTextContent("No deck yet");
    expect(slot("alice")).toHaveTextContent("Not ready");
    expect(
      screen.getByText("Waiting for a player. Share the code or the link."),
    ).toBeInTheDocument();

    updateRoom(CODE, (room) => {
      seatGuest(room, "bob");
    });
    await waitFor(() => {
      expect(slot("bob")).toHaveTextContent("Offline");
    });
    expect(slot("bob")).toHaveTextContent("No deck yet");

    updatePlayer(CODE, BOB.user_id, { connected: true, deckId: "bob-deck", ready: true });
    await waitFor(() => {
      expect(slot("bob")).toHaveTextContent("Online");
    });
    expect(slot("bob")).toHaveTextContent("Deck chosen");
    expect(slot("bob")).toHaveTextContent("Ready");
    expect(slot("bob")).not.toHaveTextContent("bob-deck");
  });
});

describe("The lobby's invite", () => {
  it("shows the code and the link, and copies each", async () => {
    addRoom({ code: CODE });
    const { user } = await openLobby();
    const invite = screen.getByRole("region", { name: "Invite a friend" });
    expect(within(invite).getByLabelText("Room code")).toHaveValue(CODE);
    expect(within(invite).getByLabelText("Link")).toHaveValue(
      `${window.location.origin}/room/${CODE}`,
    );

    await user.click(within(invite).getByRole("button", { name: "Copy code" }));
    expect(await navigator.clipboard.readText()).toBe(CODE);
    await user.click(within(invite).getByRole("button", { name: "Copy link" }));
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/room/${CODE}`);
    expect(within(invite).getAllByText("Copied")).toHaveLength(2);
  });

  it("selects the code for copying by hand when the clipboard fails, and logs it", async () => {
    addRoom({ code: CODE });
    const { user } = await openLobby();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValue(new Error("Write permission denied"));

    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(
      screen.getByText("Couldn't copy the code. It's selected: copy it by hand."),
    ).toBeInTheDocument();
    const field = screen.getByLabelText<HTMLInputElement>("Room code");
    expect(field.selectionEnd).toBe(CODE.length);
    expect(logged("room.copy_failed").map((entry) => [entry.level, entry.fields])).toEqual([
      ["warn", { what: "code" }],
    ]);
    writeText.mockRestore();
  });
});

describe("The lobby's deck picker", () => {
  it("lists the decks, with each refused deck's problems and a way to fix it", async () => {
    addRoom({ code: CODE });
    addRoomDeck("Fire deck");
    const refused = addRoomDeck("Test deck", {
      cardCount: 12,
      problems: [
        { kind: "size", count: 12, size: 30 },
        {
          kind: "copies",
          max: 2,
          cards: [
            { id: "c1", name: "Wolf" },
            { id: "c2", name: "Bear" },
          ],
        },
      ],
    });
    await openLobby();

    await waitFor(() => {
      expect(deckOption("Fire deck")).toBeEnabled();
    });
    expect(screen.getByText("30 / 30 cards")).toBeInTheDocument();
    expect(deckOption("Test deck")).toBeDisabled();
    expect(deckOption("Test deck")).toHaveAccessibleDescription(
      "12 of 30 cards More than 2 copies: Wolf, Bear",
    );
    const edit = screen.getByRole("link", { name: "Edit deck Test deck" });
    expect(edit).toHaveAttribute("href", `/decks/${refused.id}`);
    expect(edit).toHaveAttribute("target", "_blank");
  });

  it("picks a deck at once, as the server marks it, and then allows ready", async () => {
    addRoom({ code: CODE });
    const deck = addRoomDeck("Fire deck");
    const { user } = await openLobby();
    expect(screen.getByRole("button", { name: "I'm ready" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "I'm ready" })).toHaveAccessibleDescription(
      "Choose a deck first",
    );

    await user.click(await screen.findByRole("radio", { name: /^Fire deck/ }));
    await waitFor(() => {
      expect(deckOption("Fire deck")).toBeChecked();
    });
    expect(sentOfType("select_deck").map((message) => message.payload)).toEqual([
      { deck_id: deck.id },
    ]);
    expect(slot("alice")).toHaveTextContent("Deck chosen");
    expect(screen.getByRole("button", { name: "I'm ready" })).toBeEnabled();
  });

  it("sends the chosen deck again when it's clicked again, after an edit", async () => {
    addRoom({ code: CODE });
    const deck = addRoomDeck("Fire deck");
    const { user } = await openLobby();
    await user.click(await screen.findByRole("radio", { name: /^Fire deck/ }));
    await waitFor(() => {
      expect(deckOption("Fire deck")).toBeChecked();
    });
    await user.click(deckOption("Fire deck"));
    await waitFor(() => {
      expect(sentOfType("select_deck")).toHaveLength(2);
    });
    expect(sentOfType("select_deck")[1]?.payload).toEqual({ deck_id: deck.id });
  });

  it("shows the problems of a deck that changed since the list loaded", async () => {
    addRoom({ code: CODE });
    const deck = addRoomDeck("Fire deck");
    const { user } = await openLobby();
    await screen.findByRole("radio", { name: /^Fire deck/ });

    // Edited elsewhere: now too small. Its pick is refused, and the list loads again.
    deck.problems = [{ kind: "size", count: 29, size: 30 }];
    await user.click(deckOption("Fire deck"));
    await waitFor(() => {
      expect(deckOption("Fire deck")).toHaveAccessibleDescription("29 of 30 cards");
    });
    expect(deckOption("Fire deck")).toBeDisabled();
    expect(deckOption("Fire deck")).not.toBeChecked();
  });

  it("says when the picked deck was deleted, and loads the list again", async () => {
    addRoom({ code: CODE });
    addRoomDeck("Fire deck");
    addRoomDeck("Ice deck");
    const { user } = await openLobby();
    await screen.findByRole("radio", { name: /^Fire deck/ });

    roomStore.decks = roomStore.decks.filter((deck) => deck.name !== "Fire deck");
    await user.click(deckOption("Fire deck"));
    expect(await screen.findByText("That deck was deleted.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("radio", { name: /^Fire deck/ })).not.toBeInTheDocument();
    });
  });

  it("loads the list again when the tab gets the focus back", async () => {
    addRoom({ code: CODE });
    addRoomDeck("Fire deck");
    await openLobby();
    await screen.findByRole("radio", { name: /^Fire deck/ });

    addRoomDeck("New deck");
    // What the browser fires when the tab is shown again.
    fireEvent(document, new Event("visibilitychange", { bubbles: true }));
    expect(await screen.findByRole("radio", { name: /^New deck/ })).toBeInTheDocument();
  });

  it("offers to build a deck when there is none", async () => {
    addRoom({ code: CODE });
    await openLobby();
    expect(await screen.findByText(/You have no decks yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a deck" })).toHaveAttribute(
      "href",
      "/decks/new",
    );
  });
});

describe("The lobby's ready button", () => {
  it("toggles ready as the server says, and says who it's waiting for", async () => {
    addRoom({ code: CODE, guest: "bob" });
    addRoomDeck("Fire deck");
    const { user } = await openLobby();
    await user.click(await screen.findByRole("radio", { name: /^Fire deck/ }));
    const ready = screen.getByRole("button", { name: "I'm ready" });
    await waitFor(() => {
      expect(ready).toBeEnabled();
    });
    expect(ready).toHaveAccessibleDescription("Waiting for bob to get ready");

    await user.click(ready);
    await waitFor(() => {
      expect(ready).toHaveAttribute("aria-pressed", "true");
    });
    expect(slot("alice")).toHaveTextContent("Ready");
    await user.click(ready);
    await waitFor(() => {
      expect(ready).toHaveAttribute("aria-pressed", "false");
    });
    expect(sentOfType("ready").map((message) => message.payload.ready)).toEqual([true, false]);
  });

  it("starts the game when both are ready", async () => {
    addRoom({ code: CODE, guest: "bob" });
    updateRoom(CODE, () => undefined);
    addRoomDeck("Fire deck");
    const { user } = await openLobby();
    updatePlayer(CODE, BOB.user_id, { connected: true, deckId: "bob-deck", ready: true });
    await user.click(await screen.findByRole("radio", { name: /^Fire deck/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "I'm ready" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "I'm ready" }));

    expect(await screen.findByRole("heading", { name: "Game in progress" })).toBeInTheDocument();
    expect(screen.getByText("You play first")).toBeInTheDocument();
  });
});

describe("Leaving the lobby", () => {
  it("lets the guest leave at once, back to the dashboard", async () => {
    addRoom({ code: CODE, host: "bob" });
    const { user, router } = await openLobby();
    await user.click(screen.getByRole("button", { name: "Leave" }));

    expect(
      await screen.findByRole("heading", { name: `Welcome, ${TEST_USER.username}` }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(sentOfType("leave")).toHaveLength(1);
    expect(roomStore.rooms.get(CODE)?.players.map((member) => member.username)).toEqual(["bob"]);
    expect(localStorage.getItem(LAST_ROOM_KEY)).toBeNull();
  });

  it("asks the host before closing the room", async () => {
    addRoom({ code: CODE, guest: "bob" });
    const { user } = await openLobby();
    await user.click(screen.getByRole("button", { name: "Close room" }));
    const dialog = screen.getByRole("dialog", { name: "Close the room?" });
    expect(dialog).toHaveTextContent("bob will be sent out.");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(sentOfType("leave")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Close room" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Close the room?" })).getByRole("button", {
        name: "Close room",
      }),
    );
    expect(
      await screen.findByRole("heading", { name: `Welcome, ${TEST_USER.username}` }),
    ).toBeInTheDocument();
    expect(roomStore.rooms.has(CODE)).toBe(false);
  });
});

describe("The lobby's server errors", () => {
  it("shows a refusal until it's dismissed or the room changes", async () => {
    addRoom({ code: CODE });
    const { user } = await openLobby();
    const stale = { seq: 3, reason: "stale_state", message: "The room changed. Try again." };
    sendToRoom(CODE, {
      type: "error",
      payload: { ...stale, reason: "stale_state", problems: null },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("The room changed. Try again.");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    sendToRoom(CODE, {
      type: "error",
      payload: { ...stale, reason: "stale_state", problems: null },
    });
    await screen.findByRole("alert");
    updateRoom(CODE, () => undefined);
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
