import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { contentStore, lastBody } from "@/test/contentStore";
import { apiUrl } from "@/test/handlers";
import { rulesetsFixture, STRICT_RULESET_ID } from "@/test/rulesetFixture";
import { addRuleset } from "@/test/rulesetHandlers";
import { createBody, openRulesEditor, turnOrder } from "@/test/rulesEditor";
import { server } from "@/test/server";

const CODE = "ABCDEFGHJK";

function strictDefinition() {
  const strict = rulesetsFixture()[1];
  if (strict === undefined) throw new Error("No fixture ruleset");
  return strict.definition;
}

describe("RulesEditor saving and leaving", () => {
  it("creates a new rule set on Save, then shows it at its own address", async () => {
    const { user, router } = await openRulesEditor("/rules/new");

    await user.type(screen.getByLabelText("Name"), "  Fast  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/rules\/[0-9a-f-]+$/);
    });
    expect(router.state.historyAction).toBe("REPLACE");
    expect(createBody()).toEqual({
      name: "Fast",
      definition: rulesetsFixture()[0]?.definition,
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Edit Fast" })).toBeInTheDocument();
    expect(contentStore.rulesets.map((ruleset) => ruleset.name)).toContain("Fast");
  });

  it("asks for a name", async () => {
    const { user } = await openRulesEditor("/rules/new");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Give the rule set a name.");
    expect(createBody()).toBeUndefined();
  });

  it("saves the whole definition, and the page is clean afterwards", async () => {
    const { user, router } = await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);

    await user.clear(screen.getByLabelText("Lanes"));
    await user.type(screen.getByLabelText("Lanes"), "4");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const definition = strictDefinition();
    await waitFor(() => {
      expect(lastBody("PATCH", `/api/rulesets/${STRICT_RULESET_ID}`)).toEqual({
        name: "Strict",
        definition: { ...definition, board: { ...definition.board, lanes: 4 } },
      });
    });
    await user.click(screen.getByRole("link", { name: "← Rule sets" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/rules");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the problems of a save the server refuses, in the same places", async () => {
    // A check that misses the problem, so only the refused save can show it.
    server.use(
      http.post(apiUrl("/api/rulesets/validate"), () =>
        HttpResponse.json({ valid: true, errors: [], definition: null }),
      ),
    );
    const { user } = await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);

    await user.click(screen.getByRole("button", { name: "Remove End turn" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't save: fix the problems listed above.",
    );
    expect(await screen.findByRole("list", { name: "Turn problems" })).toHaveTextContent(
      "A turn must end with 'end_turn'",
    );
    expect(screen.getByText("1 problem")).toBeInTheDocument();
  });

  it("puts the server's name error on the name field", async () => {
    server.use(
      http.patch(apiUrl("/api/rulesets/:id"), () =>
        HttpResponse.json(
          { detail: [{ loc: ["body", "name"], msg: "String should have at most 40 characters" }] },
          { status: 422 },
        ),
      ),
    );
    const { user } = await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(
        "String should have at most 40 characters",
      );
    });
  });

  it("shows that the rule set is gone when it was deleted elsewhere", async () => {
    const { user } = await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);
    contentStore.rulesets = contentStore.rulesets.filter(
      (ruleset) => ruleset.id !== STRICT_RULESET_ID,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("This rule set doesn't exist, or it isn't yours."),
    ).toBeInTheDocument();
  });

  it("asks before leaving with unsaved changes", async () => {
    const { user, router } = await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);

    await user.click(screen.getByRole("button", { name: "Remove Gain mana" }));
    await user.click(screen.getByRole("link", { name: "← Rule sets" }));
    let dialog = screen.getByRole("dialog", { name: "Leave without saving?" });
    expect(dialog).toHaveTextContent("Your changes to this rule set will be lost.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(router.state.location.pathname).toBe(`/rules/${STRICT_RULESET_ID}`);
    expect(turnOrder()).toEqual(["Draw", "Action phase", "End turn"]);

    await user.click(screen.getByRole("link", { name: "← Rule sets" }));
    dialog = screen.getByRole("dialog", { name: "Leave without saving?" });
    await user.click(within(dialog).getByRole("button", { name: "Leave" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/rules");
    });
  });

  it("asks the browser to warn before the tab closes, only while there are changes", async () => {
    const { user } = await openRulesEditor(`/rules/${STRICT_RULESET_ID}`);
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);

    await user.click(screen.getByRole("button", { name: "Move Gain mana down" }));
    expect(unload()).toBe(true);

    // Moving it back leaves nothing to save.
    await user.click(screen.getByRole("button", { name: "Move Gain mana up" }));
    expect(unload()).toBe(false);
  });

  it("deletes after asking, warns about the share link, and goes back to the list", async () => {
    const ruleset = addRuleset("aggro", { shareCode: CODE });
    const { user, router } = await openRulesEditor(`/rules/${ruleset.id}`);
    await user.click(screen.getByRole("button", { name: "Remove Gain mana" }));

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete aggro?" });
    expect(dialog).toHaveTextContent("Its share link stops working.");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/rules");
    });
    expect(contentStore.rulesets.map((candidate) => candidate.name)).not.toContain("aggro");
    expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
  });

  it("shares the saved version, and says so while there are unsaved changes", async () => {
    const ruleset = addRuleset("aggro", { shareCode: CODE });
    const { user } = await openRulesEditor(`/rules/${ruleset.id}`);

    await user.click(screen.getByRole("button", { name: "Share" }));
    let dialog = screen.getByRole("dialog", { name: "Share aggro" });
    expect(within(dialog).getByText(CODE)).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("unsaved changes");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Remove Gain mana" }));
    await user.click(screen.getByRole("button", { name: "Share" }));
    dialog = screen.getByRole("dialog", { name: "Share aggro" });
    expect(dialog).toHaveTextContent(
      "You have unsaved changes. The link shares the saved version.",
    );
  });
});
