import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { addCard, addDeck, contentStore, lastBody, SYSTEM_ORIGIN_IDS } from "@/test/contentStore";
import { renderApp, saveSession } from "@/test/renderApp";

const { forest, neutral, volcano } = SYSTEM_ORIGIN_IDS;

async function openBuilder(path: string) {
  saveSession();
  const view = renderApp(path);
  await screen.findByRole("form", { name: "Deck" });
  return view;
}

const libraryCard = (name: string) => screen.getByRole("button", { name: `Add ${name}` });
const deckHeading = () => screen.getByRole("heading", { name: /^Deck ·/ });

describe("DeckBuilderPage", () => {
  it("creates a deck on its first Save, then moves to the deck's address", async () => {
    const wolf = addCard({ name: "Wolf", origin_id: forest });
    const scout = addCard({ name: "Scout", origin_id: neutral });
    addCard({ name: "Imp", origin_id: volcano });
    const { user, router } = await openBuilder("/decks/new");
    expect(screen.getByRole("heading", { name: "New deck" })).toBeInTheDocument();
    expect(screen.getByText("Pick an origin to see its cards.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Give the deck a name.")).toBeInTheDocument();
    expect(screen.getByText("Pick an origin.")).toBeInTheDocument();
    expect(contentStore.decks).toEqual([]);

    await user.type(screen.getByLabelText("Name"), "Forest rush");
    await user.selectOptions(screen.getByLabelText("Origin"), "Forest");
    await screen.findByRole("list", { name: "Library cards" });
    expect(screen.queryByRole("button", { name: "Add Imp" })).not.toBeInTheDocument();
    await user.click(libraryCard("Wolf"));
    await user.click(libraryCard("Wolf"));
    await user.click(libraryCard("Scout"));
    expect(deckHeading()).toHaveTextContent("3 cards");
    expect(libraryCard("Wolf")).toHaveAccessibleDescription("2 in deck");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Edit Forest rush" })).toBeInTheDocument();
    expect(lastBody("POST", "/api/decks")).toEqual({
      name: "Forest rush",
      origin_id: forest,
      cards: [
        { card_id: scout.id, count: 1 },
        { card_id: wolf.id, count: 2 },
      ],
    });
    const created = contentStore.decks[0];
    expect(router.state.location.pathname).toBe(`/decks/${created?.id ?? ""}`);
    expect(router.state.historyAction).toBe("REPLACE");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a saved deck with its name, origin and cards", async () => {
    const wolf = addCard({ name: "Wolf", origin_id: forest, mana_cost: 2 });
    const scout = addCard({ name: "Scout", origin_id: neutral, mana_cost: 1 });
    const deck = addDeck("Forest rush", forest, [
      { cardId: wolf.id, count: 2 },
      { cardId: scout.id, count: 1 },
    ]);
    await openBuilder(`/decks/${deck.id}`);

    expect(screen.getByRole("heading", { name: "Edit Forest rush" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Forest rush");
    expect(screen.getByLabelText("Origin")).toHaveValue(forest);
    expect(deckHeading()).toHaveTextContent("3 cards");
    const rows = within(screen.getByRole("list", { name: "Deck cards" })).getAllByRole("listitem");
    expect(rows.map((row) => within(row).getByText(/^(Wolf|Scout)$/).textContent)).toEqual([
      "Scout",
      "Wolf",
    ]);
    expect(await screen.findByRole("button", { name: "Add Wolf" })).toHaveAccessibleDescription(
      "2 in deck",
    );
  });

  it("adds a card with the keyboard as well as the mouse", async () => {
    addCard({ name: "Wolf", origin_id: forest });
    const deck = addDeck("Forest rush", forest);
    const { user } = await openBuilder(`/decks/${deck.id}`);

    (await screen.findByRole("button", { name: "Add Wolf" })).focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(libraryCard("Wolf")).toHaveAccessibleDescription("2 in deck");
  });

  it("keeps copies from 1 to 4, and the deck at 60 cards at most", async () => {
    const wolf = addCard({ name: "Wolf", origin_id: forest });
    const deck = addDeck("Forest rush", forest, [{ cardId: wolf.id, count: 3 }]);
    const { user } = await openBuilder(`/decks/${deck.id}`);

    await user.click(await screen.findByRole("button", { name: "Add Wolf" }));
    expect(libraryCard("Wolf")).toBeDisabled();
    expect(libraryCard("Wolf")).toHaveAccessibleDescription("4 in deck (full)");
    expect(screen.getByRole("button", { name: "Add one Wolf" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Remove one Wolf" }));
    expect(screen.getByRole("button", { name: "Add one Wolf" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Add one Wolf" }));
    expect(deckHeading()).toHaveTextContent("4 cards");
    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByRole("button", { name: "Remove one Wolf" }));
    }
    expect(screen.queryByRole("button", { name: "Remove one Wolf" })).not.toBeInTheDocument();
    expect(screen.getByText("Click or drag library cards here.")).toBeInTheDocument();
  });

  it("stops at 60 cards", async () => {
    const full = Array.from({ length: 15 }, (_, i) => ({
      cardId: addCard({ name: `Card ${String(i).padStart(2, "0")}`, origin_id: forest }).id,
      count: 4,
    }));
    addCard({ name: "Elk", origin_id: forest });
    const deck = addDeck("Big", forest, full);
    await openBuilder(`/decks/${deck.id}`);

    expect(await screen.findByRole("button", { name: "Add Elk" })).toBeDisabled();
    expect(deckHeading()).toHaveTextContent("60 cards");
    expect(screen.getByText("A deck holds at most 60 cards.")).toBeInTheDocument();
  });

  it("filters the library by kind and name", async () => {
    addCard({ name: "Wolf", origin_id: forest });
    addCard({ name: "Wolfsbane", origin_id: forest, kind: "spell", hp: null });
    addCard({ name: "Scout", origin_id: neutral });
    const deck = addDeck("Forest rush", forest);
    const { user } = await openBuilder(`/decks/${deck.id}`);
    const library = await screen.findByRole("list", { name: "Library cards" });
    expect(within(library).getAllByRole("button")).toHaveLength(3);

    await user.type(screen.getByLabelText("Search"), "wolf");
    expect(
      within(library)
        .getAllByRole("button")
        .map((card) => card.ariaLabel),
    ).toEqual(["Add Wolf", "Add Wolfsbane"]);
    await user.selectOptions(screen.getByLabelText("Kind"), "Spells");
    expect(
      within(library)
        .getAllByRole("button")
        .map((card) => card.ariaLabel),
    ).toEqual(["Add Wolfsbane"]);
  });

  it("asks before an origin change drops cards, and saves the origin and the cards together", async () => {
    const wolf = addCard({ name: "Wolf", origin_id: forest });
    const scout = addCard({ name: "Scout", origin_id: neutral });
    const deck = addDeck("Mixed", forest, [
      { cardId: wolf.id, count: 2 },
      { cardId: scout.id, count: 1 },
    ]);
    const { user } = await openBuilder(`/decks/${deck.id}`);
    const origin = screen.getByLabelText("Origin");

    await user.selectOptions(origin, "Volcano");
    let dialog = screen.getByRole("dialog", { name: "Change the origin to Volcano?" });
    expect(dialog).toHaveTextContent("These 2 cards will be removed");
    expect(within(dialog).getByRole("listitem")).toHaveTextContent("Wolf ×2");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(origin).toHaveValue(forest);
    expect(deckHeading()).toHaveTextContent("3 cards");

    await user.selectOptions(origin, "Volcano");
    dialog = screen.getByRole("dialog", { name: "Change the origin to Volcano?" });
    await user.click(within(dialog).getByRole("button", { name: "Change origin" }));
    expect(origin).toHaveValue(volcano);
    expect(deckHeading()).toHaveTextContent("1 card");

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(lastBody("PATCH", `/api/decks/${deck.id}`)).toEqual({
        name: "Mixed",
        origin_id: volcano,
        cards: [{ card_id: scout.id, count: 1 }],
      });
    });
    expect(contentStore.decks[0]?.originId).toBe(volcano);
  });

  it("changes the origin without asking when every card still fits", async () => {
    const scout = addCard({ name: "Scout", origin_id: neutral });
    const deck = addDeck("Scouts", forest, [scout.id]);
    const { user } = await openBuilder(`/decks/${deck.id}`);

    await user.selectOptions(screen.getByLabelText("Origin"), "Ocean");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Origin")).toHaveValue(SYSTEM_ORIGIN_IDS.ocean);
    expect(deckHeading()).toHaveTextContent("1 card");
  });

  it("checks the deck against the default ruleset, or a chosen one, and draws the mana curve", async () => {
    const wolf = addCard({ name: "Wolf", origin_id: forest, mana_cost: 2 });
    const scout = addCard({ name: "Scout", origin_id: neutral, mana_cost: 8 });
    const deck = addDeck("Mixed", forest, [
      { cardId: wolf.id, count: 3 },
      { cardId: scout.id, count: 1 },
    ]);
    const { user } = await openBuilder(`/decks/${deck.id}`);
    const checks = screen.getByRole("list", { name: "Deck checks" });

    expect(screen.getByLabelText("Rules")).toHaveDisplayValue("Default");
    expect(checks).toHaveTextContent("Problem: 4 / 30 cards");
    expect(checks).toHaveTextContent("Problem: More than 2 copies: Wolf");
    expect(checks).toHaveTextContent("Passes: Neutral cards allowed");

    await user.selectOptions(screen.getByLabelText("Rules"), "Strict");
    expect(checks).toHaveTextContent("Problem: 4 / 20 cards");
    expect(checks).toHaveTextContent("Problem: More than 1 copies: Wolf");
    expect(checks).toHaveTextContent("Problem: Neutral cards not allowed: Scout");

    const curve = screen.getByRole("figure", { name: "Mana curve" });
    expect(curve).toHaveTextContent("2 mana: 3 cards");
    expect(curve).toHaveTextContent("7+ mana: 1 card");
  });

  it("says when a deck doesn't exist", async () => {
    saveSession();
    renderApp("/decks/20000000-0000-4000-8000-999999999999");

    expect(
      await screen.findByText("This deck doesn't exist, or it isn't yours."),
    ).toBeInTheDocument();
  });
});
