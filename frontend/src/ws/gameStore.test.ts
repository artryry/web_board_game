import { describe, expect, it } from "vitest";

import { gameStateMessage, gameView } from "@/test/gameViewFixture";
import { addRoom, roomStateFor } from "@/test/roomStore";

import { applyServerMessage, emptyRoomData, type RoomData } from "./gameStore";
import type { ErrorPayload } from "./messages";

const NOW = 1_800_000_000_000;

function errorMessage(payload: Partial<ErrorPayload>) {
  return {
    type: "error" as const,
    payload: {
      seq: 5,
      reason: "deck_not_playable" as const,
      message: "This deck doesn't fit the room's rules",
      problems: null,
      ...payload,
    },
  };
}

function withPendingDeck(): RoomData {
  return { ...emptyRoomData(), pendingDeck: { seq: 5, deckId: "deck-1" } };
}

describe("applyServerMessage", () => {
  it("takes the room from room_state and clears the last error", () => {
    const room = roomStateFor(addRoom());
    const state = {
      ...emptyRoomData(),
      lastError: errorMessage({ reason: "stale_state" }).payload,
    };
    expect(applyServerMessage(state, { type: "room_state", payload: room }, NOW)).toEqual({
      room,
      lastError: null,
    });
  });

  it("keeps the latest game_state and the server's clock offset", () => {
    const view = gameView({ version: 4 });
    const change = applyServerMessage(emptyRoomData(), gameStateMessage(view, NOW + 1500), NOW);
    expect(change).toEqual({
      game: { view, legalActions: [{ type: "surrender" }], deadline: null },
      clockOffset: 1500,
    });
  });

  it("takes the result from game_over", () => {
    const message = {
      type: "game_over" as const,
      payload: { winner: 1 as const, reason: "conquered" as const },
    };
    expect(applyServerMessage(emptyRoomData(), message, NOW)).toEqual({
      result: { winner: 1, reason: "conquered" },
    });
  });

  it("puts a refused select_deck on its deck, with the problems", () => {
    const problems = [{ kind: "size" as const, count: 12, size: 30 }];
    expect(applyServerMessage(withPendingDeck(), errorMessage({ problems }), NOW)).toEqual({
      deckError: { deckId: "deck-1", reason: "deck_not_playable", problems },
      pendingDeck: null,
    });
    expect(
      applyServerMessage(withPendingDeck(), errorMessage({ reason: "deck_not_found" }), NOW),
    ).toEqual({
      deckError: { deckId: "deck-1", reason: "deck_not_found", problems: [] },
      pendingDeck: null,
    });
  });

  it("keeps any other refusal as the last error", () => {
    const otherSeq = errorMessage({ seq: 9 });
    expect(applyServerMessage(withPendingDeck(), otherSeq, NOW)).toEqual({
      lastError: otherSeq.payload,
    });
    const notAboutDeck = errorMessage({ reason: "no_deck", message: "Select a deck first" });
    expect(applyServerMessage(withPendingDeck(), notAboutDeck, NOW)).toEqual({
      lastError: notAboutDeck.payload,
    });
  });

  it("changes nothing for events, room_closed and pong", () => {
    const state = emptyRoomData();
    expect(
      applyServerMessage(state, { type: "events", payload: { seq: null, events: [] } }, NOW),
    ).toEqual({});
    expect(applyServerMessage(state, { type: "room_closed", payload: null }, NOW)).toEqual({});
    expect(applyServerMessage(state, { type: "pong", payload: null }, NOW)).toEqual({});
  });
});
