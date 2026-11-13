import { describe, expect, it } from "vitest";

import { ApiError } from "@/api/errors";
import type { RuleError } from "@/api/hooks/useRulesets";

import { errorPlace, invalidRulesetErrors, placeRuleErrors } from "./ruleErrors";

const error = (path: RuleError["path"], message: string): RuleError => ({
  path,
  code: "invalid_value",
  message,
});

describe("placeRuleErrors", () => {
  it("puts settings and phase params under their fields, first message first", () => {
    const placed = placeRuleErrors([
      error(["board", "lanes"], "Input should be less than or equal to 5"),
      error(["board", "lanes"], "A second message"),
      error(["turn", 2, "params", "time_limit_s"], "Input should be less than or equal to 600"),
      error(["turn", 0, "params", "allow", 1], "Input should be 'play', 'move' or 'attack'"),
    ]);

    expect(Object.fromEntries(placed.fields)).toEqual({
      "board.lanes": "Input should be less than or equal to 5",
      "turn.2.params.time_limit_s": "Input should be less than or equal to 600",
      "turn.0.params.allow": "Input should be 'play', 'move' or 'attack'",
    });
    expect([...placed.marked].sort()).toEqual(["turn.0", "turn.2"]);
    expect(placed.phases.size).toBe(0);
  });

  it("puts phase and key errors on the phase, and pipeline rules under the pipeline", () => {
    const placed = placeRuleErrors([
      error(["setup", 1], "'action_phase' can't be in setup"),
      error(["turn", 3, "key"], "Unknown phase module 'nap'"),
      error(["turn", 2, "params"], "Input should be a valid dictionary"),
      error(["turn"], "A turn must end with 'end_turn'"),
      error(["turn"], "A turn needs a phase where players act"),
    ]);

    expect(Object.fromEntries(placed.phases)).toEqual({
      "setup.1": ["'action_phase' can't be in setup"],
      "turn.3": ["Unknown phase module 'nap'"],
      "turn.2": ["Input should be a valid dictionary"],
    });
    expect([...placed.marked].sort()).toEqual(["setup.1", "turn.2", "turn.3"]);
    expect(placed.pipelines.get("turn")).toEqual([
      "A turn must end with 'end_turn'",
      "A turn needs a phase where players act",
    ]);
    expect(placed.pipelines.get("setup")).toBeUndefined();
  });

  it("keeps every error for the header, the ones with no place too", () => {
    const errors = [
      error(["schema_version"], "Input should be 1"),
      error(["board"], "Input should be a valid dictionary"),
      error(["rounds"], "Extra inputs are not permitted"),
    ];
    const placed = placeRuleErrors(errors);

    expect(placed.all).toEqual(errors);
    expect(placed.fields.size + placed.phases.size + placed.pipelines.size).toBe(0);
  });
});

describe("invalidRulesetErrors", () => {
  it("reads the errors of a 422 invalid_ruleset", () => {
    const errors = [error(["board", "lanes"], "Input should be less than or equal to 5")];
    const refused = new ApiError(422, "invalid_ruleset", "The ruleset has 1 error(s)", { errors });

    expect(invalidRulesetErrors(refused)).toEqual(errors);
  });

  it("is null for any other error", () => {
    expect(invalidRulesetErrors(new ApiError(404, "ruleset_not_found", "Not found"))).toBeNull();
    expect(invalidRulesetErrors(new Error("offline"))).toBeNull();
  });
});

describe("errorPlace", () => {
  const phaseName = (pipeline: string, index: number) =>
    pipeline === "turn" && index === 2 ? "Action phase" : undefined;

  it("names settings, pipelines and phases", () => {
    expect(errorPlace(["board", "lanes"], phaseName)).toBe("Lanes");
    expect(errorPlace(["mana", "start"], phaseName)).toBe("Starting mana");
    expect(errorPlace(["turn"], phaseName)).toBe("Turn");
    expect(errorPlace(["turn", 2, "params", "time_limit_s"], phaseName)).toBe(
      "Turn, phase 3 (Action phase)",
    );
    expect(errorPlace(["setup", 0], phaseName)).toBe("Setup, phase 1");
  });

  it("is null for a path the editor doesn't show", () => {
    expect(errorPlace(["schema_version"], phaseName)).toBeNull();
    expect(errorPlace(["board"], phaseName)).toBeNull();
  });
});
