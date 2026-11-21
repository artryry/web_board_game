import { describe, expect, it } from "vitest";

import { resultHeadline, resultReason } from "./resultText";

describe("resultHeadline", () => {
  it("says who won, from the player's seat", () => {
    expect(resultHeadline(0, 0)).toBe("You won");
    expect(resultHeadline(1, 0)).toBe("You lost");
    expect(resultHeadline(null, 1)).toBe("Draw");
  });
});

describe("resultReason", () => {
  it.each([
    ["conquered", 0, "Sections conquered."],
    ["conquered", 1, "Sections conquered."],
    ["surrender", 0, "bob surrendered."],
    ["surrender", 1, "You surrendered."],
    ["out_of_cards", null, "Both players ran out of cards."],
    ["abandoned", 0, "bob left the game."],
    ["abandoned", 1, "You were away too long."],
  ] as const)("%s with winner %s", (reason, winner, text) => {
    expect(resultReason(reason, winner, 0, "bob")).toBe(text);
  });
});
