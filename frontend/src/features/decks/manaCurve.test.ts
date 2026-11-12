import { describe, expect, it } from "vitest";

import { addCard } from "@/test/contentStore";

import { manaCurve } from "./manaCurve";

describe("manaCurve", () => {
  it("has a bar for each cost from 0 to 6, and one for 7 and up", () => {
    expect(manaCurve([]).map((bar) => bar.label)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7+",
    ]);
    expect(manaCurve([]).every((bar) => bar.count === 0)).toBe(true);
  });

  it("counts every copy", () => {
    const entries = [
      { card: addCard({ name: "Spark", mana_cost: 0 }), count: 1 },
      { card: addCard({ name: "Wolf", mana_cost: 2 }), count: 3 },
      { card: addCard({ name: "Elk", mana_cost: 2 }), count: 1 },
      { card: addCard({ name: "Drake", mana_cost: 7 }), count: 2 },
      { card: addCard({ name: "Titan", mana_cost: 10 }), count: 1 },
    ];

    expect(manaCurve(entries).map((bar) => bar.count)).toEqual([1, 0, 4, 0, 0, 0, 0, 3]);
  });
});
