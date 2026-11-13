import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { STRICT_RULESET_ID } from "@/test/rulesetFixture";
import { openRulesEditor, phaseItem, validatedDefinitions } from "@/test/rulesEditor";

async function openStrict() {
  const view = await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);
  expect(await screen.findByText("No problems")).toBeInTheDocument();
  return view;
}

function problems(): string[] {
  return within(screen.getByRole("list", { name: "Problems" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);
}

describe("RulesEditor validation", () => {
  it("shows a setting's bound under its field and in the header's list", async () => {
    const { user } = await openStrict();

    await user.clear(screen.getByLabelText("Lanes"));
    await user.type(screen.getByLabelText("Lanes"), "9");

    expect(await screen.findByText("1 problem")).toBeInTheDocument();
    expect(problems()).toEqual(["Lanes: Input should be less than or equal to 5"]);
    expect(screen.getByLabelText("Lanes")).toHaveAccessibleDescription(
      "Input should be less than or equal to 5",
    );

    await user.clear(screen.getByLabelText("Lanes"));
    await user.type(screen.getByLabelText("Lanes"), "4");

    expect(await screen.findByText("No problems")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Problems" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Lanes")).not.toHaveAccessibleDescription();
  });

  it("shows a pipeline rule under the pipeline's heading", async () => {
    const { user } = await openStrict();

    await user.click(screen.getByRole("button", { name: "Remove End turn" }));

    const turnProblems = await screen.findByRole("list", { name: "Turn problems" });
    expect(turnProblems).toHaveTextContent("A turn must end with 'end_turn'");
    expect(problems()).toEqual(["Turn: A turn must end with 'end_turn'"]);

    await user.click(screen.getByRole("button", { name: "Add End turn to Turn" }));

    expect(await screen.findByText("No problems")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Turn problems" })).not.toBeInTheDocument();
  });

  it("shows a phase's own problem on the phase, with a mark", async () => {
    const { user } = await openStrict();

    await user.click(screen.getByRole("button", { name: "Move End turn up" }));

    const endTurn = phaseItem("Turn", 3);
    await waitFor(() => {
      expect(endTurn).toHaveTextContent("'end_turn' must be the last phase");
    });
    expect(within(endTurn).getByText("Has problems")).toBeInTheDocument();
    expect(problems()).toEqual(["Turn, phase 3 (End turn): 'end_turn' must be the last phase"]);
  });

  it("shows a phase that can't go in Setup", async () => {
    const { user } = await openStrict();

    await user.click(screen.getByRole("button", { name: "Add Action phase to Setup" }));

    await waitFor(() => {
      expect(phaseItem("Setup", 2)).toHaveTextContent(
        "'action_phase' can't be in setup, which runs once and waits for no one",
      );
    });
  });

  it("checks a phase param in the browser first, and lists the server's message", async () => {
    const { user } = await openStrict();
    const action = phaseItem("Turn", 3);

    await user.click(within(action).getByRole("button", { name: "Action phase settings" }));
    const timeLimit = within(action).getByLabelText("Time limit (s)");
    await user.clear(timeLimit);
    await user.type(timeLimit, "700");
    await user.tab();

    expect(timeLimit).toHaveAccessibleDescription("Use 600 or less.");
    expect(await screen.findByText("1 problem")).toBeInTheDocument();
    expect(problems()).toEqual([
      "Turn, phase 3 (Action phase): Input should be less than or equal to 600",
    ]);
    // Collapsed, the phase still says it has a problem.
    await user.click(within(action).getByRole("button", { name: "Action phase settings" }));
    expect(within(action).getByText("Has problems")).toBeInTheDocument();
    expect(action).toHaveTextContent("⏱ 700 s");
  });

  it("checks once the typing stops, not on every key", async () => {
    const { user } = await openStrict();
    const before = validatedDefinitions().length;

    await user.clear(screen.getByLabelText("Section HP"));
    await user.type(screen.getByLabelText("Section HP"), "45");

    expect(await screen.findByText("No problems")).toBeInTheDocument();
    await waitFor(() => {
      expect(validatedDefinitions()).toHaveLength(before + 1);
    });
    expect(validatedDefinitions().at(-1)).toMatchObject({ board: { section_hp: 45 } });
  });
});
