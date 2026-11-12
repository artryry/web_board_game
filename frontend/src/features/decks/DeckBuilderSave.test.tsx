import { screen, waitFor, within } from "@testing-library/react";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { addCard, addDeck, contentStore, SYSTEM_ORIGIN_IDS } from "@/test/contentStore";
import { apiError, apiUrl } from "@/test/handlers";
import { renderApp, saveSession } from "@/test/renderApp";
import { server } from "@/test/server";

const { forest } = SYSTEM_ORIGIN_IDS;

/** A saved forest deck with one Wolf, open in the builder. */
async function openSavedDeck(shareCode: string | null = null) {
  const wolf = addCard({ name: "Wolf", origin_id: forest });
  const deck = addDeck("Forest rush", forest, [wolf.id], shareCode);
  saveSession();
  const view = renderApp(`/decks/${deck.id}`);
  await screen.findByRole("form", { name: "Deck" });
  await screen.findByRole("button", { name: "Add Wolf" });
  return { ...view, deck, wolf };
}

function failSave(status: number, code: string, message: string, extra = {}) {
  server.use(http.patch(apiUrl("/api/decks/:id"), () => apiError(status, code, message, extra)));
}

describe("DeckBuilderPage saving and leaving", () => {
  it("lists the cards the server says don't fit the origin", async () => {
    const { user, wolf } = await openSavedDeck();
    failSave(
      422,
      "card_origin_mismatch",
      "1 card(s) are neither of the deck's origin nor neutral",
      {
        cards: [{ id: wolf.id, name: "Wolf" }],
      },
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("1 card(s) are neither of the deck's origin nor neutral");
    expect(within(alert).getByRole("listitem")).toHaveTextContent("Wolf");
  });

  it("shows the server's size limit", async () => {
    const { user } = await openSavedDeck();
    failSave(422, "deck_too_large", "A deck holds at most 60 cards");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A deck holds at most 60 cards");
  });

  it("asks for a reload when a card was deleted elsewhere", async () => {
    const { user } = await openSavedDeck();
    failSave(422, "invalid_deck_cards", "A deck can only hold your own cards");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A card in this deck no longer exists. Reload the page",
    );
  });

  it("shows that the deck is gone when it was deleted elsewhere", async () => {
    const { user, deck } = await openSavedDeck();
    contentStore.decks = contentStore.decks.filter((candidate) => candidate.id !== deck.id);

    await user.click(screen.getByRole("button", { name: "Add Wolf" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("This deck doesn't exist, or it isn't yours."),
    ).toBeInTheDocument();
  });

  it("asks before leaving with unsaved changes", async () => {
    const { user, router, deck } = await openSavedDeck();
    await user.click(screen.getByRole("button", { name: "Add Wolf" }));

    await user.click(screen.getByRole("link", { name: "← Decks" }));
    let dialog = screen.getByRole("dialog", { name: "Leave without saving?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(router.state.location.pathname).toBe(`/decks/${deck.id}`);

    await user.click(screen.getByRole("link", { name: "← Decks" }));
    dialog = screen.getByRole("dialog", { name: "Leave without saving?" });
    await user.click(within(dialog).getByRole("button", { name: "Leave" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/decks");
    });
  });

  it("asks the browser to warn before the tab closes, only while there are changes", async () => {
    const { user } = await openSavedDeck();
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);

    await user.click(screen.getByRole("button", { name: "Add Wolf" }));
    expect(unload()).toBe(true);

    await user.click(screen.getByRole("button", { name: "Remove one Wolf" }));
    expect(unload()).toBe(false);
  });

  it("leaves without asking once the changes are saved", async () => {
    const { user, router, wolf } = await openSavedDeck();
    await user.click(screen.getByRole("button", { name: "Add Wolf" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(contentStore.decks[0]?.cards).toEqual([{ cardId: wolf.id, count: 2 }]);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });

    await user.click(screen.getByRole("link", { name: "← Decks" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/decks");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("deletes the deck after asking and goes back to the list", async () => {
    const { user, router } = await openSavedDeck("ABCDEFGHJK");
    await user.click(screen.getByRole("button", { name: "Add Wolf" }));

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Forest rush?" });
    expect(dialog).toHaveTextContent("Its share link stops working.");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/decks");
    });
    expect(contentStore.decks).toEqual([]);
    expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
  });

  it("shares the saved version, and says so while there are unsaved changes", async () => {
    const { user } = await openSavedDeck("ABCDEFGHJK");

    await user.click(screen.getByRole("button", { name: "Share" }));
    let dialog = screen.getByRole("dialog", { name: "Share Forest rush" });
    expect(within(dialog).getByText("ABCDEFGHJK")).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("unsaved changes");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Add Wolf" }));
    await user.click(screen.getByRole("button", { name: "Share" }));
    dialog = screen.getByRole("dialog", { name: "Share Forest rush" });
    expect(dialog).toHaveTextContent(
      "You have unsaved changes. The link shares the saved version.",
    );
  });
});
