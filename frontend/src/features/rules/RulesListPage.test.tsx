import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { contentStore } from "@/test/contentStore";
import { renderApp, saveSession } from "@/test/renderApp";
import { DEFAULT_RULESET_ID, STRICT_RULESET_ID } from "@/test/rulesetFixture";
import { addRuleset } from "@/test/rulesetHandlers";

const CODE = "ABCDEFGHJK";

async function openRules() {
  saveSession();
  const view = renderApp("/rules");
  await screen.findByRole("heading", { name: "Rule sets" });
  return view;
}

function rows(section: string) {
  return within(screen.getByRole("region", { name: section })).getAllByRole("listitem");
}

describe("RulesListPage", () => {
  it("lists the default, then the user's own by name, with summaries and the shared mark", async () => {
    addRuleset("aggro", { shareCode: CODE });
    await openRules();

    const [defaultRow] = rows("Default");
    expect(defaultRow).toHaveTextContent("3 lanes · 30-card decks · 4 turn phases");
    const own = defaultRow === undefined ? [] : within(defaultRow).getAllByRole("link");
    expect(own.map((link) => link.getAttribute("href"))).toEqual([
      `/rules/${DEFAULT_RULESET_ID}`,
      `/rules/${DEFAULT_RULESET_ID}`,
      `/rules/new?from=${DEFAULT_RULESET_ID}`,
    ]);
    expect(within(defaultRow ?? document.body).queryByRole("button")).not.toBeInTheDocument();

    const [aggro, strict] = rows("My rule sets");
    expect(aggro).toHaveTextContent("aggro");
    expect(aggro).toHaveTextContent("Shared");
    expect(strict).toHaveTextContent("Strict");
    expect(strict).toHaveTextContent("3 lanes · 20-card decks · 4 turn phases");
    expect(strict).not.toHaveTextContent("Shared");
    expect(screen.getByRole("link", { name: "Edit Strict" })).toHaveAttribute(
      "href",
      `/rules/${STRICT_RULESET_ID}`,
    );
    expect(screen.getByRole("link", { name: "Duplicate Strict" })).toHaveAttribute(
      "href",
      `/rules/new?from=${STRICT_RULESET_ID}`,
    );
    expect(screen.getByRole("link", { name: "New rule set" })).toHaveAttribute(
      "href",
      "/rules/new",
    );
  });

  it("says there are no rule sets of the user's own yet", async () => {
    contentStore.rulesets = contentStore.rulesets.filter((ruleset) => ruleset.is_system);
    await openRules();

    expect(
      screen.getByText("No rule sets yet. Duplicate the default, or start a new one."),
    ).toBeInTheDocument();
  });

  it("deletes a rule set after asking, and warns that a shared one's link stops working", async () => {
    addRuleset("aggro", { shareCode: CODE });
    const { user } = await openRules();

    await user.click(screen.getByRole("button", { name: "Delete aggro" }));
    const dialog = screen.getByRole("dialog", { name: "Delete aggro?" });
    expect(dialog).toHaveTextContent("Its share link stops working.");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(rows("My rule sets")).toHaveLength(1);
    });
    expect(contentStore.rulesets.map((ruleset) => ruleset.name)).toEqual(["Default", "Strict"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("doesn't mention a share link when deleting an unshared rule set", async () => {
    const { user } = await openRules();

    await user.click(screen.getByRole("button", { name: "Delete Strict" }));

    expect(screen.getByRole("dialog", { name: "Delete Strict?" })).not.toHaveTextContent(
      "share link",
    );
  });

  it("shares a rule set, and the list marks it as shared", async () => {
    const { user } = await openRules();

    await user.click(screen.getByRole("button", { name: "Share Strict" }));
    const dialog = screen.getByRole("dialog", { name: "Share Strict" });
    await user.click(within(dialog).getByRole("button", { name: "Create link" }));

    const code = await waitFor(() => {
      const stored = contentStore.rulesets.find((ruleset) => ruleset.name === "Strict");
      expect(stored?.share_code).toEqual(expect.any(String));
      return stored?.share_code ?? "";
    });
    expect(await within(dialog).findByText(code)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(await screen.findByText("Shared")).toBeInTheDocument();
  });
});
