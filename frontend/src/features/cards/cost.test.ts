import { describe, expect, it } from "vitest";

import { isRecord } from "@/api/errors";
import { findModule } from "@/catalog/useCatalog";
import { CATALOG } from "@/test/catalogFixture";

import casesJson from "../../../../backend/tests/fixtures/cost_cases.json?raw";

import { abilityCost, cardPoints, suggestManaCost } from "./cost";

// The backend runs these same cases against engine/cost.py, so the two formulas can't drift.
interface CostCase {
  case: string;
  kind: "creature" | "spell";
  hp: number | null;
  dmg: number | null;
  ability_costs: number[];
  points: number;
  suggested: number;
}

function isCostCase(value: unknown): value is CostCase {
  return (
    isRecord(value) &&
    typeof value.case === "string" &&
    (value.kind === "creature" || value.kind === "spell") &&
    (value.hp === null || typeof value.hp === "number") &&
    (value.dmg === null || typeof value.dmg === "number") &&
    Array.isArray(value.ability_costs) &&
    typeof value.points === "number" &&
    typeof value.suggested === "number"
  );
}

const parsed: unknown = JSON.parse(casesJson);
const cases = Array.isArray(parsed) ? (parsed as unknown[]).filter(isCostCase) : [];

describe("cost", () => {
  it("reads every case from the backend's fixture", () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(cases).toHaveLength((parsed as unknown[]).length);
  });

  it.each(cases)("$case", ({ kind, hp, dmg, ability_costs, points, suggested }) => {
    expect(cardPoints(kind, hp, dmg, ability_costs)).toBe(points);
    expect(suggestManaCost(points)).toBe(suggested);
  });

  it("prices an ability from its catalog spec: base + weight × param", () => {
    const armor = findModule(CATALOG.features, "armor");
    const taunt = findModule(CATALOG.features, "taunt");
    const draw = findModule(CATALOG.spells, "draw_cards");

    expect(armor && abilityCost(armor.cost, { amount: 3 })).toBe(3);
    expect(taunt && abilityCost(taunt.cost, {})).toBe(2);
    expect(draw && abilityCost(draw.cost, { count: 2 })).toBe(4);
  });

  it("counts an empty or invalid input as 0", () => {
    expect(cardPoints("creature", Number.NaN, 2, [])).toBe(2);
    const armor = findModule(CATALOG.features, "armor");
    expect(armor && abilityCost(armor.cost, { amount: Number.NaN })).toBe(0);
  });
});
