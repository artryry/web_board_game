import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { contentStore } from "@/test/contentStore";
import { TEST_USER } from "@/test/handlers";
import { renderApp, saveSession } from "@/test/renderApp";
import { addRoom } from "@/test/roomStore";

import { LAST_ROOM_KEY, rememberRoom } from "./lastRoom";

function joinRequests() {
  return contentStore.requests.filter((request) => request.path === "/api/rooms/join");
}

async function openJoinDialog() {
  saveSession();
  const view = renderApp("/");
  await view.user.click(await screen.findByRole("button", { name: "Join by code" }));
  const dialog = await screen.findByRole("dialog", { name: "Join a room" });
  return { ...view, dialog };
}

describe("The dashboard's Play section", () => {
  it("offers Create room and Join by code", async () => {
    saveSession();
    renderApp("/");
    const play = await screen.findByRole("region", { name: "Play" });
    expect(within(play).getByRole("link", { name: "Create room" })).toHaveAttribute(
      "href",
      "/rooms/new",
    );
    expect(within(play).getByRole("button", { name: "Join by code" })).toBeInTheDocument();
  });

  it("joins a room by its code, in any case and with spaces, and opens it", async () => {
    addRoom({ code: "ABC234", host: "bob" });
    const { user, dialog, router } = await openJoinDialog();
    await user.type(within(dialog).getByLabelText("Room code"), " abc 234 ");
    await user.click(within(dialog).getByRole("button", { name: "Join" }));

    expect(await screen.findByRole("heading", { name: "Room ABC234" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/room/ABC234");
    // The room page used the dialog's answer instead of joining again.
    expect(joinRequests().map((request) => request.body)).toEqual([{ code: "ABC234" }]);
  });

  it("asks for a code when the field is empty", async () => {
    const { user, dialog } = await openJoinDialog();
    await user.click(within(dialog).getByRole("button", { name: "Join" }));
    expect(within(dialog).getByLabelText("Room code")).toHaveAccessibleDescription(
      "Enter the room's code.",
    );
    expect(joinRequests()).toHaveLength(0);
  });

  it("shows a wrong code and a full room in the dialog, so the code can be fixed", async () => {
    addRoom({ code: "FUL234", host: "bob", status: "playing" });
    const { user, dialog } = await openJoinDialog();
    const field = within(dialog).getByLabelText("Room code");

    await user.type(field, "NOPE99");
    await user.click(within(dialog).getByRole("button", { name: "Join" }));
    await waitFor(() => {
      expect(field).toHaveAccessibleDescription("No room has this code. It may have closed.");
    });

    await user.clear(field);
    await user.type(field, "FUL234");
    await user.click(within(dialog).getByRole("button", { name: "Join" }));
    await waitFor(() => {
      expect(field).toHaveAccessibleDescription("This room is full, or its game has started.");
    });
    expect(screen.getByRole("dialog", { name: "Join a room" })).toBeInTheDocument();
  });
});

describe("Back to room", () => {
  it("offers the last room this user joined while it's on", async () => {
    addRoom({ code: "ABC234" });
    rememberRoom(TEST_USER.id, "ABC234");
    saveSession();
    renderApp("/");
    expect(
      await screen.findByRole("link", { name: "Back to room ABC234 · In the lobby" }),
    ).toHaveAttribute("href", "/room/ABC234");
  });

  it("says when the room's game is on", async () => {
    addRoom({ code: "ABC234", guest: "bob", status: "playing" });
    rememberRoom(TEST_USER.id, "ABC234");
    saveSession();
    renderApp("/");
    expect(
      await screen.findByRole("link", { name: "Back to room ABC234 · Game in progress" }),
    ).toBeInTheDocument();
  });

  it("isn't offered for a room another user joined on this browser", async () => {
    addRoom({ code: "ABC234" });
    rememberRoom("someone-else", "ABC234");
    saveSession();
    renderApp("/");
    await screen.findByRole("region", { name: "Play" });
    expect(screen.queryByRole("link", { name: /Back to room/ })).not.toBeInTheDocument();
  });

  it.each([
    ["is gone", () => undefined],
    ["has finished", () => addRoom({ code: "ABC234", guest: "bob", status: "finished" })],
  ])("forgets a room that %s", async (_label, setUp) => {
    setUp();
    rememberRoom(TEST_USER.id, "ABC234");
    saveSession();
    renderApp("/");
    await waitFor(() => {
      expect(localStorage.getItem(LAST_ROOM_KEY)).toBeNull();
    });
    expect(screen.queryByRole("link", { name: /Back to room/ })).not.toBeInTheDocument();
  });
});
