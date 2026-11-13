import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { lastBody } from "@/test/contentStore";
import { rulesetsFixture, STRICT_RULESET_ID } from "@/test/rulesetFixture";
import { addRuleset } from "@/test/rulesetHandlers";
import { openRulesEditor, phaseItem, phaseItems, turnOrder } from "@/test/rulesEditor";

// jsdom can't drag (it has no layout), so the drag itself is covered by the e2e test.

describe("RulesEditor phases", () => {
  it("adds a phase to Turn just before End turn, and to the end of Setup", async () => {
    const { user } = await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);

    await user.click(screen.getByRole("button", { name: "Add Lane combat to Turn" }));
    expect(turnOrder()).toEqual(["Gain mana", "Draw", "Action phase", "Lane combat", "End turn"]);

    await user.click(screen.getByRole("button", { name: "Add Gain mana to Setup" }));
    expect(phaseItems("Setup").map((item) => item.textContent)).toEqual([
      expect.stringContaining("Draw · Count 3"),
      expect.stringContaining("Gain mana"),
    ]);
    // The palette keeps the focus, so phases can be added one after another.
    expect(screen.getByRole("button", { name: "Add Gain mana to Setup" })).toHaveFocus();
  });

  it("adds a phase with its default params", async () => {
    const { user } = await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);

    await user.click(screen.getByRole("button", { name: "Add Action phase to Setup" }));

    expect(phaseItem("Setup", 2)).toHaveTextContent(
      "Action phase · Actor Active, Allow Play / Move / Attack, Time limit (s) 90",
    );
    expect(phaseItem("Setup", 2)).toHaveTextContent("⏱ 90 s");
  });

  it("moves phases up and down, and keeps the focus on a usable button", async () => {
    const { user } = await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);

    await user.click(within(phaseItem("Turn", 2)).getByRole("button", { name: "Move Draw up" }));
    expect(turnOrder()).toEqual(["Draw", "Gain mana", "Action phase", "End turn"]);
    // At the top, Move up is disabled; the focus went to Move down.
    const draw = phaseItem("Turn", 1);
    expect(within(draw).getByRole("button", { name: "Move Draw up" })).toBeDisabled();
    expect(within(draw).getByRole("button", { name: "Move Draw down" })).toHaveFocus();
    expect(screen.getByText("Draw was moved to position 1 of 4.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Move Gain mana down" }));
    expect(turnOrder()).toEqual(["Draw", "Action phase", "Gain mana", "End turn"]);
    expect(screen.getByRole("button", { name: "Move Gain mana down" })).toHaveFocus();
  });

  it("removes a phase and gives the focus to its list's heading", async () => {
    const { user } = await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);

    await user.click(screen.getByRole("button", { name: "Remove Gain mana" }));

    expect(turnOrder()).toEqual(["Draw", "Action phase", "End turn"]);
    expect(screen.getByRole("heading", { name: "Turn" })).toHaveFocus();

    await user.click(within(phaseItem("Setup", 1)).getByRole("button", { name: "Remove Draw" }));
    expect(screen.getByText("No setup phases.")).toBeInTheDocument();
  });

  it("edits a phase's params, and saves the whole definition", async () => {
    const { user } = await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);
    const draw = phaseItem("Turn", 2);

    const toggle = within(draw).getByRole("button", { name: "Draw settings" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.clear(within(draw).getByLabelText("Count"));
    await user.type(within(draw).getByLabelText("Count"), "2");
    expect(draw).toHaveTextContent("Draw · Count 2");
    // A phase without params has nothing to open.
    expect(within(phaseItem("Turn", 4)).queryByRole("button", { name: /settings/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save" }));

    const strict = rulesetsFixture()[1];
    await waitFor(() => {
      expect(lastBody("PATCH", `/api/rulesets/${STRICT_RULESET_ID}`)).toEqual({
        name: "Strict",
        definition: {
          ...strict?.definition,
          turn: strict?.definition.turn.map((phase) =>
            phase.key === "draw" ? { key: "draw", params: { count: 2 } } : phase,
          ),
        },
      });
    });
  });

  it("keeps a phase's settings open when it moves", async () => {
    const { user } = await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);

    const draw = phaseItem("Turn", 2);
    await user.click(within(draw).getByRole("button", { name: "Draw settings" }));
    await user.click(within(draw).getByRole("button", { name: "Move Draw up" }));

    expect(within(phaseItem("Turn", 1)).getByLabelText("Count")).toHaveValue(1);
    expect(within(phaseItem("Turn", 2)).queryByLabelText("Count")).toBeNull();
  });

  it("shows a phase the catalog doesn't know, which can only be removed", async () => {
    const base = rulesetsFixture()[1]?.definition;
    if (base === undefined) throw new Error("No fixture ruleset");
    const ruleset = addRuleset("Old", {
      definition: { ...base, turn: [{ key: "nap", params: { hours: 2 } }, ...base.turn] },
    });
    const { user } = await openRulesEditor(`/rules/${ruleset.id}`);

    const nap = phaseItem("Turn", 1);
    expect(nap).toHaveTextContent("Unknown phase “nap”");
    expect(
      within(nap)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Remove Unknown phase “nap”"]);
    expect(turnOrder()[0]).toBe("nap");

    await user.click(within(nap).getByRole("button", { name: "Remove Unknown phase “nap”" }));
    expect(turnOrder()).toEqual(["Gain mana", "Draw", "Action phase", "End turn"]);
  });
});
