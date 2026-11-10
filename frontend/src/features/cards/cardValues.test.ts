import { describe, expect, it } from "vitest";

import { CATALOG } from "@/test/catalogFixture";
import { addCard, addGroup, contentStore, SYSTEM_ORIGIN_IDS } from "@/test/contentStore";

import {
  attackStat,
  cardContent,
  emptyCard,
  fromCard,
  suggestedCost,
  toCardBody,
  type CardFormValues,
} from "./cardValues";

function values(overrides: Partial<CardFormValues>): CardFormValues {
  return {
    kind: "creature",
    name: " Wolf ",
    origin_id: SYSTEM_ORIGIN_IDS.forest,
    mana_cost: 2,
    hp: 3,
    dmg: 2,
    abilities: [],
    group_id: "",
    art_key: null,
    ...overrides,
  };
}

describe("toCardBody", () => {
  it("sends a creature's stats and a trimmed name, with no group as null", () => {
    expect(toCardBody(values({}), CATALOG)).toEqual({
      kind: "creature",
      name: "Wolf",
      origin_id: SYSTEM_ORIGIN_IDS.forest,
      mana_cost: 2,
      hp: 3,
      dmg: 2,
      abilities: [],
      group_id: null,
      art_key: null,
    });
  });

  it("follows the spell effect's dmg_use: damage, heal as a negative number, or none", () => {
    const spell = (key: string) =>
      toCardBody(values({ kind: "spell", dmg: 3, abilities: [{ key, params: {} }] }), CATALOG);

    expect(spell("deal_damage")).toMatchObject({ hp: null, dmg: 3 });
    expect(spell("heal")).toMatchObject({ hp: null, dmg: -3 });
    expect(spell("draw_cards")).toMatchObject({ hp: null, dmg: null });
  });
});

describe("fromCard", () => {
  it("shows a stored heal as the amount healed", () => {
    const card = addCard({
      name: "Mend",
      kind: "spell",
      hp: null,
      dmg: -3,
      abilities: [{ key: "heal", params: { target: "creature" } }],
    });
    expect(fromCard(card)).toMatchObject({ kind: "spell", dmg: 3, hp: 1, group_id: "" });
  });
});

describe("emptyCard", () => {
  it("starts in the library's origin and group, or in Neutral and no group", () => {
    const group = addGroup("Beasts");
    expect(
      emptyCard({ origin: SYSTEM_ORIGIN_IDS.forest, group: group.id }, contentStore.origins, [
        group,
      ]),
    ).toMatchObject({ origin_id: SYSTEM_ORIGIN_IDS.forest, group_id: group.id });
    expect(
      emptyCard({ origin: null, group: "ungrouped" }, contentStore.origins, [group]),
    ).toMatchObject({
      kind: "creature",
      hp: 1,
      dmg: 1,
      mana_cost: 1,
      origin_id: SYSTEM_ORIGIN_IDS.neutral,
      group_id: "",
    });
  });
});

describe("suggestedCost", () => {
  it("adds the abilities' catalog costs to the stats", () => {
    const content = cardContent(
      values({ hp: 3, dmg: 3, abilities: [{ key: "armor", params: { amount: 2 } }] }),
      CATALOG,
    );
    // 3 + 3 + 2 = 8 points → 4 mana.
    expect(suggestedCost(content, CATALOG)).toBe(4);
  });
});

describe("attackStat", () => {
  it("labels a negative DMG as a heal and hides a missing one", () => {
    expect(attackStat(2)).toEqual({ label: "DMG", value: 2 });
    expect(attackStat(-3)).toEqual({ label: "Heal", value: 3 });
    expect(attackStat(null)).toBeNull();
  });
});
