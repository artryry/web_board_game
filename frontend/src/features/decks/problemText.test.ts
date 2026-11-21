import { describe, expect, it } from "vitest";

import { deckProblemText, fromRoomProblem } from "./problemText";

describe("deckProblemText", () => {
  it("words each kind of problem", () => {
    expect(deckProblemText({ kind: "size", count: 12, size: 30 })).toBe("12 of 30 cards");
    expect(deckProblemText({ kind: "copies", max: 2, cards: ["Wolf", "Bear"] })).toBe(
      "More than 2 copies: Wolf, Bear",
    );
    expect(deckProblemText({ kind: "neutral", cards: ["Squire"] })).toBe(
      "Neutral cards not allowed: Squire",
    );
  });
});

describe("fromRoomProblem", () => {
  it("names the server's cards by name", () => {
    const wolf = { id: "c1", name: "Wolf" };
    expect(fromRoomProblem({ kind: "copies", max: 2, cards: [wolf] })).toEqual({
      kind: "copies",
      max: 2,
      cards: ["Wolf"],
    });
    expect(fromRoomProblem({ kind: "neutral", cards: [wolf] })).toEqual({
      kind: "neutral",
      cards: ["Wolf"],
    });
    expect(fromRoomProblem({ kind: "size", count: 3, size: 10 })).toEqual({
      kind: "size",
      count: 3,
      size: 10,
    });
  });
});
