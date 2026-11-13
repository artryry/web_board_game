import { describe, expect, it } from "vitest";

import { rulesetsFixture } from "@/test/rulesetFixture";

import {
  duplicateValues,
  newValues,
  rulesetSummary,
  savedValues,
  toRulesetBody,
} from "./rulesetValues";

function fixture() {
  const [defaultRuleset, strict] = rulesetsFixture();
  if (defaultRuleset === undefined || strict === undefined) throw new Error("No fixture rulesets");
  return { defaultRuleset, strict };
}

describe("rulesetValues", () => {
  it("starts a new ruleset from the default's rules, with no name", () => {
    const { defaultRuleset } = fixture();
    const values = newValues(defaultRuleset);

    expect(values.name).toBe("");
    expect(toRulesetBody(values).definition).toEqual(defaultRuleset.definition);
  });

  it("names a duplicate '<name> copy', cut to 40 characters", () => {
    const { strict } = fixture();

    expect(duplicateValues(strict).name).toBe("Strict copy");
    expect(duplicateValues({ ...strict, name: "x".repeat(40) }).name).toBe("x".repeat(40));
    expect(duplicateValues({ ...strict, name: `${"x".repeat(35)} rule` }).name).toBe(
      `${"x".repeat(35)} rule`,
    );
  });

  it("copies the definition, so editing the form leaves the cached ruleset alone", () => {
    const { strict } = fixture();
    const values = savedValues(strict);

    values.board.lanes = 5;
    const firstParams = values.turn[1]?.params;
    if (firstParams !== undefined) firstParams.count = 4;

    expect(strict.definition.board.lanes).toBe(3);
    expect(strict.definition.turn[1]?.params).toEqual({ count: 1 });
  });

  it("fills in missing params and sends the trimmed name with the whole definition", () => {
    const { strict } = fixture();
    const values = savedValues({
      ...strict,
      definition: { ...strict.definition, setup: [{ key: "draw" }] },
    });
    values.name = "  Fast  ";

    const body = toRulesetBody(values);

    expect(body.name).toBe("Fast");
    expect(body.definition).toEqual({ ...strict.definition, setup: [{ key: "draw", params: {} }] });
  });

  it("summarizes lanes, deck size and turn phases", () => {
    const { defaultRuleset } = fixture();
    const definition = defaultRuleset.definition;

    expect(rulesetSummary(definition)).toBe("3 lanes · 30-card decks · 4 turn phases");
    expect(
      rulesetSummary({
        ...definition,
        board: { ...definition.board, lanes: 1 },
        turn: definition.turn.slice(0, 1),
      }),
    ).toBe("1 lane · 30-card decks · 1 turn phase");
  });
});
