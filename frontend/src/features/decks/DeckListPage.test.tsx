import { screen, waitFor, within } from "@testing-library/react";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { addCard, addDeck, contentStore, SYSTEM_ORIGIN_IDS } from "@/test/contentStore";
import { apiError, apiUrl } from "@/test/handlers";
import { renderApp, saveSession } from "@/test/renderApp";
import { server } from "@/test/server";

const { forest, volcano } = SYSTEM_ORIGIN_IDS;

async function openDecks() {
  saveSession();
  const view = renderApp("/decks");
  await screen.findByRole("heading", { name: "Decks" });
  return view;
}

function deckRows() {
  return within(screen.getByRole("list", { name: "Decks" })).getAllByRole("listitem");
}

describe("DeckListPage", () => {
  it("lists the decks newest first, with origin, size against the default and the shared mark", async () => {
    const wolf = addCard({ name: "Wolf", origin_id: forest });
    addDeck("Forest rush", forest, [{ cardId: wolf.id, count: 3 }]);
    addDeck("Embers", volcano, [], "ABCDEFGHJK");
    await openDecks();

    await waitFor(() => {
      expect(deckRows()).toHaveLength(2);
    });
    const [embers, forestRush] = deckRows();
    expect(embers).toHaveTextContent("Embers");
    expect(embers).toHaveTextContent("Volcano");
    expect(embers).toHaveTextContent("0 / 30 cards");
    expect(embers).toHaveTextContent("Shared");
    expect(forestRush).toHaveTextContent("Forest");
    expect(forestRush).toHaveTextContent("3 / 30 cards");
    expect(forestRush).not.toHaveTextContent("Shared");
    const link = within(forestRush ?? document.body).getByRole("link", { name: "Forest rush" });
    expect(link).toHaveAttribute("href", `/decks/${contentStore.decks[1]?.id ?? ""}`);
  });

  it("shows only the count when the rulesets don't load", async () => {
    server.use(http.get(apiUrl("/api/rulesets"), () => apiError(500, "internal_error")));
    addDeck("Forest rush", forest, [addCard({ name: "Wolf", origin_id: forest }).id]);
    await openDecks();

    expect(await screen.findByText("1 cards")).toBeInTheDocument();
  });

  it("says there are no decks yet", async () => {
    await openDecks();

    expect(await screen.findByText("No decks yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New deck" })).toHaveAttribute("href", "/decks/new");
  });

  it("deletes a deck after asking, and warns that a shared deck's link stops working", async () => {
    addDeck("Embers", volcano, [], "ABCDEFGHJK");
    const { user } = await openDecks();

    await user.click(await screen.findByRole("button", { name: "Delete Embers" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Embers?" });
    expect(dialog).toHaveTextContent("Its share link stops working.");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("No decks yet.")).toBeInTheDocument();
    expect(contentStore.decks).toEqual([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a typed share code, whatever its case and spaces", async () => {
    const { user, router } = await openDecks();

    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Enter a share code.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Share code"), " abcde fghjk ");
    await user.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/share/ABCDEFGHJK");
    });
  });
});
