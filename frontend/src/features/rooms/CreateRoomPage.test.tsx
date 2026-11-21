import { screen, waitFor, within } from "@testing-library/react";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { contentStore, lastBody } from "@/test/contentStore";
import { apiError, apiUrl } from "@/test/handlers";
import { renderApp, saveSession } from "@/test/renderApp";
import { DEFAULT_RULESET_ID, STRICT_RULESET_ID } from "@/test/rulesetFixture";
import { server } from "@/test/server";

async function renderCreateRoom() {
  saveSession();
  const view = renderApp("/rooms/new");
  const rules = await screen.findByRole("group", { name: "Rule set" });
  return { ...view, rules };
}

describe("CreateRoomPage", () => {
  it("lists the default first, then the user's own, each with a summary", async () => {
    const { rules } = await renderCreateRoom();
    const options = within(rules).getAllByRole("radio");
    expect(options.map((option) => option.closest("label")?.textContent)).toEqual([
      "Default",
      "Strict",
    ]);
    expect(within(rules).getByRole("radio", { name: "Default" })).toBeChecked();
    expect(within(rules).getByRole("radio", { name: "Default" })).toHaveAccessibleDescription(
      "3 lanes · 30-card decks · 4 turn phases",
    );
    expect(within(rules).getByRole("radio", { name: "Strict" })).toHaveAccessibleDescription(
      "3 lanes · 20-card decks · 4 turn phases",
    );
  });

  it("creates a room with the picked rule set and opens it in place of the form", async () => {
    const { user, rules, router } = await renderCreateRoom();
    await user.click(within(rules).getByRole("radio", { name: "Strict" }));
    await user.click(screen.getByRole("button", { name: "Create room" }));

    expect(await screen.findByRole("heading", { name: "Room ABC234" })).toBeInTheDocument();
    expect(lastBody("POST", "/api/rooms")).toEqual({ ruleset_id: STRICT_RULESET_ID });
    expect(screen.getByText(/^Rule set: Strict/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/room/ABC234");
    expect(router.state.historyAction).toBe("REPLACE");
    // The room page took the create's answer: no join.
    expect(contentStore.requests.some((request) => request.path === "/api/rooms/join")).toBe(false);
  });

  it("shows the picked rule set in full on request", async () => {
    const { user } = await renderCreateRoom();
    const toggle = screen.getByRole("button", { name: "Show rules" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(await screen.findByRole("button", { name: "Hide rules" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("explains a rule set the server can't use, with a link to fix it", async () => {
    server.use(
      http.post(apiUrl("/api/rooms"), () =>
        apiError(422, "invalid_ruleset", "The ruleset has 1 error(s)", { errors: [] }),
      ),
    );
    const { user } = await renderCreateRoom();
    await user.click(screen.getByRole("button", { name: "Create room" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "This rule set has problems since a module changed. Open it in the rules editor to fix it.",
    );
    expect(within(alert).getByRole("link", { name: "Open the rule set" })).toHaveAttribute(
      "href",
      `/rules/${DEFAULT_RULESET_ID}`,
    );
  });

  it("says when the rule set was deleted, and refreshes the list", async () => {
    const { user, rules } = await renderCreateRoom();
    await user.click(within(rules).getByRole("radio", { name: "Strict" }));
    contentStore.rulesets = contentStore.rulesets.filter(
      (ruleset) => ruleset.id !== STRICT_RULESET_ID,
    );
    await user.click(screen.getByRole("button", { name: "Create room" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This rule set was deleted.");
    await waitFor(() => {
      expect(within(rules).queryByRole("radio", { name: "Strict" })).not.toBeInTheDocument();
    });
    expect(within(rules).getByRole("radio", { name: "Default" })).toBeChecked();
  });

  it("shows any other failure", async () => {
    server.use(
      http.post(apiUrl("/api/rooms"), () => apiError(500, "internal_server_error", "Boom")),
    );
    const { user } = await renderCreateRoom();
    await user.click(screen.getByRole("button", { name: "Create room" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Boom");
  });
});
