import { describe, expect, it } from "vitest";

import { addCard, SYSTEM_ORIGIN_IDS } from "@/test/contentStore";

import { deckProblems } from "./deckProblems";

const { forest, neutral } = SYSTEM_ORIGIN_IDS;
const FOREST_DECK = { deck: forest, neutral };
const RULES = { size: 6, max_copies: 2, allow_neutral: true };

describe("deckProblems", () => {
  it("passes a deck of exactly the size, within the copies", () => {
    const entries = [
      { card: addCard({ name: "Wolf", origin_id: forest }), count: 2 },
      { card: addCard({ name: "Bear", origin_id: forest }), count: 2 },
      { card: addCard({ name: "Scout", origin_id: neutral }), count: 2 },
    ];

    expect(deckProblems(entries, RULES, FOREST_DECK)).toEqual([]);
  });

  it("wants exactly the size: fewer and more are both problems", () => {
    const wolf = addCard({ name: "Wolf", origin_id: forest });

    expect(deckProblems([{ card: wolf, count: 2 }], RULES, FOREST_DECK)).toEqual([
      { kind: "size", count: 2, size: 6 },
    ]);
    expect(deckProblems([{ card: wolf, count: 2 }], { ...RULES, size: 1 }, FOREST_DECK)).toEqual([
      { kind: "size", count: 2, size: 1 },
    ]);
  });

  it("names the cards over the copy limit", () => {
    const entries = [
      { card: addCard({ name: "Wolf", origin_id: forest }), count: 3 },
      { card: addCard({ name: "Bear", origin_id: forest }), count: 2 },
      { card: addCard({ name: "Elk", origin_id: forest }), count: 4 },
    ];

    expect(deckProblems(entries, { ...RULES, size: 9 }, FOREST_DECK)).toEqual([
      { kind: "copies", max: 2, cards: ["Wolf", "Elk"] },
    ]);
  });

  it("names neutral cards in a deck of another origin when the rules forbid them", () => {
    const entries = [
      { card: addCard({ name: "Wolf", origin_id: forest }), count: 2 },
      { card: addCard({ name: "Scout", origin_id: neutral }), count: 2 },
      { card: addCard({ name: "Healer", origin_id: neutral }), count: 2 },
    ];
    const noNeutral = { ...RULES, allow_neutral: false };

    expect(deckProblems(entries, noNeutral, FOREST_DECK)).toEqual([
      { kind: "neutral", cards: ["Scout", "Healer"] },
    ]);
    expect(deckProblems(entries, RULES, FOREST_DECK)).toEqual([]);
  });

  it("lets a neutral deck pass when neutral cards aren't allowed: they are its own origin", () => {
    const entries = [{ card: addCard({ name: "Scout", origin_id: neutral }), count: 2 }];

    expect(
      deckProblems(
        entries,
        { size: 2, max_copies: 2, allow_neutral: false },
        { deck: neutral, neutral },
      ),
    ).toEqual([]);
  });
});
