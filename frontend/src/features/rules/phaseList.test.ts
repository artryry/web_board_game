import { describe, expect, it } from "vitest";

import { findModule } from "@/catalog/useCatalog";
import { CATALOG } from "@/test/catalogFixture";

import { newPhase, phaseInsertIndex } from "./phaseList";

const phase = (key: string) => ({ key, params: {} });

describe("phaseInsertIndex", () => {
  it("adds to Turn just before a final end_turn", () => {
    const turn = [phase("gain_mana"), phase("action_phase"), phase("end_turn")];
    expect(phaseInsertIndex(turn, "turn")).toBe(2);
  });

  it("adds at the end of a Turn that doesn't end with end_turn", () => {
    expect(phaseInsertIndex([phase("end_turn"), phase("action_phase")], "turn")).toBe(2);
    expect(phaseInsertIndex([], "turn")).toBe(0);
  });

  it("always adds at the end of Setup", () => {
    expect(phaseInsertIndex([phase("draw"), phase("end_turn")], "setup")).toBe(2);
  });
});

describe("newPhase", () => {
  it("takes the module's default params", () => {
    const action = findModule(CATALOG.phases, "action_phase");
    const draw = findModule(CATALOG.phases, "draw");
    const endTurn = findModule(CATALOG.phases, "end_turn");
    if (action === undefined || draw === undefined || endTurn === undefined) {
      throw new Error("The fixture lacks a phase");
    }

    expect(newPhase(draw)).toEqual({ key: "draw", params: { count: 1 } });
    expect(newPhase(endTurn)).toEqual({ key: "end_turn", params: {} });
    expect(newPhase(action)).toEqual({
      key: "action_phase",
      params: { actor: "active", allow: ["play", "move", "attack"], time_limit_s: 90 },
    });
  });
});
