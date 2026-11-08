import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { http } from "msw";

import { apiError, apiUrl, LIBRARY_TOTALS, TEST_USER } from "@/test/handlers";
import { renderApp, saveSession } from "@/test/renderApp";
import { server } from "@/test/server";

/** The `<dd>` next to a tile's label. */
function tileValue(label: string): Element | null {
  return screen.getByText(label, { selector: "dt" }).nextElementSibling;
}

describe("DashboardPage", () => {
  it("greets the user and counts their cards, card groups and decks", async () => {
    saveSession();
    renderApp("/");

    expect(
      await screen.findByRole("heading", { name: `Welcome, ${TEST_USER.username}` }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(tileValue("Cards")).toHaveTextContent(String(LIBRARY_TOTALS.cards));
    });
    expect(tileValue("Card groups")).toHaveTextContent(String(LIBRARY_TOTALS.cardGroups));
    expect(tileValue("Decks")).toHaveTextContent(String(LIBRARY_TOTALS.decks));
  });

  it("shows an error on a tile whose count fails, and still shows the others", async () => {
    server.use(http.get(apiUrl("/api/decks"), () => apiError(500, "internal_server_error")));
    saveSession();
    renderApp("/");

    await waitFor(() => {
      expect(tileValue("Decks")).toHaveTextContent("Couldn't load");
    });
    expect(tileValue("Cards")).toHaveTextContent(String(LIBRARY_TOTALS.cards));
  });
});
