import { describe, expect, it } from "vitest";

import { isRecord } from "@/api/errors";
import { addCard, SYSTEM_ORIGIN_IDS } from "@/test/contentStore";

import casesJson from "../../../../backend/tests/fixtures/deck_rule_cases.json?raw";

import { deckProblems } from "./deckProblems";

// The backend runs these same cases against deck_service.deck_problems (which checks a deck when
// it is picked for a room), so the two checks can't drift.
type OriginKey = "neutral" | "forest";

interface CaseCard {
  name: string;
  origin: OriginKey;
  mana_cost: number;
  count: number;
}

interface DeckRuleCase {
  case: string;
  rules: { size: number; max_copies: number; allow_neutral: boolean };
  deck_origin: OriginKey;
  cards: CaseCard[];
  problems: unknown[];
}

function isOriginKey(value: unknown): value is OriginKey {
  return value === "neutral" || value === "forest";
}

function isCaseCard(value: unknown): value is CaseCard {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isOriginKey(value.origin) &&
    typeof value.mana_cost === "number" &&
    typeof value.count === "number"
  );
}

function isDeckRuleCase(value: unknown): value is DeckRuleCase {
  return (
    isRecord(value) &&
    typeof value.case === "string" &&
    isRecord(value.rules) &&
    typeof value.rules.size === "number" &&
    typeof value.rules.max_copies === "number" &&
    typeof value.rules.allow_neutral === "boolean" &&
    isOriginKey(value.deck_origin) &&
    Array.isArray(value.cards) &&
    (value.cards as unknown[]).every(isCaseCard) &&
    Array.isArray(value.problems)
  );
}

const parsed: unknown = JSON.parse(casesJson);
const rawCases: unknown[] = Array.isArray(parsed) ? (parsed as unknown[]) : [];
const cases = rawCases.filter(isDeckRuleCase);

describe("deckProblems", () => {
  it("reads every case from the backend's fixture", () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(cases).toHaveLength(rawCases.length);
  });

  it.each(cases)("$case", ({ rules, deck_origin, cards, problems }) => {
    const entries = cards.map((card) => ({
      card: addCard({
        name: card.name,
        origin_id: SYSTEM_ORIGIN_IDS[card.origin],
        mana_cost: card.mana_cost,
      }),
      count: card.count,
    }));
    const origins = { deck: SYSTEM_ORIGIN_IDS[deck_origin], neutral: SYSTEM_ORIGIN_IDS.neutral };

    expect(deckProblems(entries, rules, origins)).toEqual(problems);
  });
});
