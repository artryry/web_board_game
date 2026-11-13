import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderApp, saveSession } from "@/test/renderApp";
import { lastBody } from "@/test/contentStore";
import { DEFAULT_RULESET_ID, rulesetsFixture, STRICT_RULESET_ID } from "@/test/rulesetFixture";
import {
  openRulesEditor,
  phaseItem,
  phaseItems,
  turnOrder,
  validatedDefinitions,
} from "@/test/rulesEditor";

describe("RulesEditorPage", () => {
  it("starts a new rule set from the default's rules, with no name", async () => {
    await openRulesEditor("/rules/new");

    expect(screen.getByRole("heading", { level: 1, name: "New rule set" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Lanes")).toHaveValue(3);
    expect(screen.getByLabelText("Slots per section")).toHaveValue(2);
    expect(screen.getByLabelText("Section HP")).toHaveValue(30);
    expect(screen.getByLabelText("Deck size")).toHaveValue(30);
    expect(screen.getByLabelText("Copies of a card")).toHaveValue(2);
    expect(screen.getByLabelText("Neutral cards in a deck of another origin")).toBeChecked();
    expect(screen.getByLabelText("Starting mana")).toHaveValue(1);
    expect(screen.getByLabelText("Mana per turn")).toHaveValue(1);
    expect(screen.getByLabelText("Maximum mana")).toHaveValue(10);
    expect(screen.getByLabelText("Grow and refill")).toBeChecked();
    expect(screen.getByLabelText("Maximum hand size")).toHaveValue(10);
    expect(screen.getByLabelText("Bonus card for the second player")).toBeChecked();
    expect(phaseItems("Setup")).toHaveLength(1);
    expect(phaseItem("Setup", 1)).toHaveTextContent("Draw · Count 3");
    expect(turnOrder()).toEqual(["Gain mana", "Draw", "Action phase", "End turn"]);
    expect(phaseItem("Turn", 3)).toHaveTextContent("⏱ 90 s");
    // Share and Delete need a saved rule set.
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
    expect(await screen.findByText("No problems")).toBeInTheDocument();
  });

  it("duplicates a rule set under '<name> copy'", async () => {
    await openRulesEditor(`/rules/new?from=${STRICT_RULESET_ID}`);

    expect(screen.getByRole("heading", { level: 1, name: "Duplicate Strict" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Strict copy");
    expect(screen.getByLabelText("Deck size")).toHaveValue(20);
    expect(screen.getByLabelText("Neutral cards in a deck of another origin")).not.toBeChecked();
  });

  it("opens the user's own rule set, with Duplicate, Share and Delete", async () => {
    await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);

    expect(screen.getByRole("heading", { level: 1, name: "Edit Strict" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Strict");
    expect(screen.getByRole("link", { name: "Duplicate" })).toHaveAttribute(
      "href",
      `/rules/new?from=${STRICT_RULESET_ID}`,
    );
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("switches how mana comes back each turn, and saves it", async () => {
    const { user } = await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);
    const mode = screen.getByRole("group", { name: "Mana each turn" });
    expect(mode).toHaveAccessibleDescription(
      /maximum mana rises by Mana per turn, up to Maximum mana, and their mana refills\./,
    );

    await user.click(screen.getByLabelText("Restore a fixed amount"));

    expect(mode).toHaveAccessibleDescription(
      /gets Mana per turn back, up to Maximum mana\. Unspent mana carries over\./,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    const definition = rulesetsFixture()[1]?.definition;
    await waitFor(() => {
      expect(lastBody("PATCH", `/api/rulesets/${STRICT_RULESET_ID}`)).toMatchObject({
        definition: { mana: { ...definition?.mana, mode: "restore" } },
      });
    });
  });

  it("draws the board as lanes and slots change", async () => {
    const { user } = await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);
    expect(
      screen.getByRole("img", { name: "Board: 3 lanes, 2 slots per section" }),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Lanes"));
    await user.type(screen.getByLabelText("Lanes"), "1");
    await user.clear(screen.getByLabelText("Slots per section"));
    await user.type(screen.getByLabelText("Slots per section"), "4");

    expect(
      screen.getByRole("img", { name: "Board: 1 lane, 4 slots per section" }),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Lanes"));
    await user.type(screen.getByLabelText("Lanes"), "50");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("No board preview for these numbers.")).toBeInTheDocument();
  });

  it("shows the default rule set read-only, with Duplicate", async () => {
    const { user } = await openRulesEditor(`/rules/${DEFAULT_RULESET_ID}`);

    expect(screen.getByRole("heading", { level: 1, name: "Default" })).toBeInTheDocument();
    expect(
      screen.getByText("This is the default rule set. Duplicate it to make your own."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Duplicate" })).toHaveAttribute(
      "href",
      `/rules/new?from=${DEFAULT_RULESET_ID}`,
    );
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Lanes")).toBeDisabled();
    expect(screen.getByLabelText("Restore a fixed amount")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Add a phase" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move|^Remove/ })).not.toBeInTheDocument();

    // The phases still open, to read their settings.
    await user.click(within(phaseItem("Setup", 1)).getByRole("button", { name: "Draw settings" }));
    expect(within(phaseItem("Setup", 1)).getByLabelText("Count")).toBeDisabled();
    expect(within(phaseItem("Setup", 1)).getByLabelText("Count")).toHaveValue(3);

    // There's nothing to check: it can't change.
    expect(screen.queryByText("No problems")).not.toBeInTheDocument();
    expect(validatedDefinitions()).toEqual([]);
  });

  it("says when the rule set doesn't exist", async () => {
    saveSession();
    renderApp("/rules/30000000-0000-4000-8000-00000000dead");

    expect(
      await screen.findByText("This rule set doesn't exist, or it isn't yours."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Rule sets" })).toHaveAttribute("href", "/rules");
  });
});
