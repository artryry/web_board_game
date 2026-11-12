import { describe, expect, it } from "vitest";

import { MAX_COPIES, MAX_DECK_SIZE } from "@/api/bounds";
import { addCard, SYSTEM_ORIGIN_IDS } from "@/test/contentStore";

import {
  addCopy,
  canAdd,
  cardsOutsideOrigin,
  copiesOf,
  deckSize,
  keepOrigin,
  removeCopy,
  sameCards,
  sortEntries,
  toDeckCards,
  type DeckEntry,
} from "./deckEntries";

const { forest, neutral, volcano } = SYSTEM_ORIGIN_IDS;

function names(entries: readonly DeckEntry[]): string[] {
  return entries.map((entry) => `${entry.card.name} ×${entry.count}`);
}

describe("deckEntries", () => {
  it("adds copies in the server's order: by cost, then name", () => {
    const wolf = addCard({ name: "Wolf", mana_cost: 2 });
    const bear = addCard({ name: "bear", mana_cost: 3 });
    const sprout = addCard({ name: "Sprout", mana_cost: 1 });
    const ant = addCard({ name: "Ant", mana_cost: 2 });

    let entries: readonly DeckEntry[] = [];
    for (const card of [wolf, bear, sprout, ant, wolf]) entries = addCopy(entries, card);

    expect(names(entries)).toEqual(["Sprout ×1", "Ant ×1", "Wolf ×2", "bear ×1"]);
    expect(deckSize(entries)).toBe(5);
    expect(copiesOf(entries, wolf.id)).toBe(2);
    expect(copiesOf(entries, addCard({ name: "Elk" }).id)).toBe(0);
  });

  it("stops at the copy limit", () => {
    const wolf = addCard({ name: "Wolf" });
    let entries: readonly DeckEntry[] = [{ card: wolf, count: MAX_COPIES - 1 }];
    expect(canAdd(entries, wolf.id)).toBe(true);

    entries = addCopy(entries, wolf);
    expect(copiesOf(entries, wolf.id)).toBe(MAX_COPIES);
    expect(canAdd(entries, wolf.id)).toBe(false);
    expect(addCopy(entries, wolf)).toBe(entries);
  });

  it("stops at the deck size limit", () => {
    const full = Array.from({ length: MAX_DECK_SIZE / 4 }, (_, i) => ({
      card: addCard({ name: `Card ${i}` }),
      count: 4,
    }));
    const elk = addCard({ name: "Elk" });

    expect(deckSize(full)).toBe(MAX_DECK_SIZE);
    expect(canAdd(full, elk.id)).toBe(false);
    expect(addCopy(full, elk)).toBe(full);
    expect(canAdd(removeCopy(full, full[0]?.card.id ?? ""), elk.id)).toBe(true);
  });

  it("removes one copy at a time, and the row with the last one", () => {
    const wolf = addCard({ name: "Wolf" });
    const bear = addCard({ name: "Bear" });
    const entries = [
      { card: wolf, count: 2 },
      { card: bear, count: 1 },
    ];

    expect(names(removeCopy(entries, wolf.id))).toEqual(["Wolf ×1", "Bear ×1"]);
    expect(names(removeCopy(entries, bear.id))).toEqual(["Wolf ×2"]);
  });

  it("finds the cards an origin change drops: neither the new origin nor neutral", () => {
    const wolf = addCard({ name: "Wolf", origin_id: forest });
    const imp = addCard({ name: "Imp", origin_id: volcano });
    const scout = addCard({ name: "Scout", origin_id: neutral });
    const entries = [
      { card: wolf, count: 2 },
      { card: imp, count: 1 },
      { card: scout, count: 3 },
    ];

    expect(names(cardsOutsideOrigin(entries, volcano, neutral))).toEqual(["Wolf ×2"]);
    expect(names(keepOrigin(entries, volcano, neutral))).toEqual(["Imp ×1", "Scout ×3"]);
    // A neutral deck holds only neutral cards.
    expect(names(keepOrigin(entries, neutral, neutral))).toEqual(["Scout ×3"]);
  });

  it("sends the whole list, and compares lists whatever their order", () => {
    const wolf = addCard({ name: "Wolf" });
    const bear = addCard({ name: "Bear" });
    const entries = [
      { card: wolf, count: 2 },
      { card: bear, count: 1 },
    ];

    expect(toDeckCards(entries)).toEqual([
      { card_id: wolf.id, count: 2 },
      { card_id: bear.id, count: 1 },
    ]);
    expect(sameCards(entries, [...entries].reverse())).toBe(true);
    expect(sameCards(entries, [{ card: wolf, count: 2 }])).toBe(false);
    expect(
      sameCards(entries, [
        { card: wolf, count: 1 },
        { card: bear, count: 1 },
      ]),
    ).toBe(false);
    expect(sortEntries([...entries].reverse()).map((entry) => entry.card.name)).toEqual([
      "Bear",
      "Wolf",
    ]);
  });
});
