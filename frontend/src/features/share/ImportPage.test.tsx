import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { STRICT_RULESET_ID } from "@/test/rulesetFixture";
import {
  addCard,
  addDeck,
  addGroup,
  addOrigin,
  contentStore,
  SYSTEM_ORIGIN_IDS,
} from "@/test/contentStore";
import { renderApp, saveSession } from "@/test/renderApp";

const { forest, neutral, volcano } = SYSTEM_ORIGIN_IDS;
const CODE = "ABCDEFGHJK";

/** Bob's "Swamp rush": two Bog trolls of his own Swamp origin and a neutral Scout. */
function seedBobsDeck() {
  const swamp = addOrigin({ name: "Swamp" });
  const troll = addCard({ name: "Bog troll", origin_id: swamp.id, mana_cost: 3 });
  const scout = addCard({ name: "Scout", origin_id: neutral, mana_cost: 1 });
  const deck = addDeck(
    "Swamp rush",
    swamp.id,
    [
      { cardId: troll.id, count: 2 },
      { cardId: scout.id, count: 1 },
    ],
    CODE,
  );
  contentStore.authors.set(deck.id, "bob");
  return { swamp, deck };
}

async function openImport(code = CODE) {
  saveSession();
  const view = renderApp(`/share/${code}`);
  await screen.findByRole("heading", { level: 1 });
  return view;
}

describe("ImportPage", () => {
  it("previews someone's deck, whatever the code's case", async () => {
    seedBobsDeck();
    await openImport(CODE.toLowerCase());

    expect(screen.getByRole("heading", { name: "Swamp rush" })).toBeInTheDocument();
    expect(screen.getByText("Deck by bob")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cards · 3" })).toBeInTheDocument();
    const cards = screen.getByRole("list", { name: "Shared cards" });
    expect(
      within(cards)
        .getAllByRole("article")
        .map((card) => card.ariaLabel),
    ).toEqual(["Scout", "Bog troll"]);
    expect(within(cards).getByText("×2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Origin" })).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "Mana curve" })).toHaveTextContent("3 mana: 2 cards");
    expect(
      screen.getByText(/Copies the cards \(and 1 custom origin\) into your library/),
    ).toBeInTheDocument();
    expect(screen.queryByText("This is yours: importing makes a copy.")).not.toBeInTheDocument();
  });

  it("imports a deck and opens the copy", async () => {
    const { swamp, deck } = seedBobsDeck();
    const { user, router } = await openImport();

    await user.click(screen.getByRole("button", { name: "Import to my library" }));

    expect(await screen.findByRole("heading", { name: "Edit Swamp rush" })).toBeInTheDocument();
    const copy = contentStore.decks[0];
    expect(copy?.id).not.toBe(deck.id);
    expect(router.state.location.pathname).toBe(`/decks/${copy?.id ?? ""}`);
    expect(copy?.originId).not.toBe(swamp.id);
    expect(contentStore.origins.filter((origin) => origin.name === "Swamp")).toHaveLength(2);
    expect(contentStore.groups.map((group) => group.name)).toEqual(["Swamp rush"]);
  });

  it("previews a card group, imports it, and opens the library on the new group", async () => {
    const beasts = addGroup("Beasts");
    addCard({ name: "Wolf", origin_id: forest, group_id: beasts.id });
    addCard({ name: "Imp", origin_id: volcano, group_id: beasts.id });
    const group = contentStore.groups.find((candidate) => candidate.id === beasts.id);
    if (group !== undefined) group.share_code = CODE;
    contentStore.authors.set(beasts.id, "bob");
    const { user, router } = await openImport();

    expect(screen.getByText("Card group by bob")).toBeInTheDocument();
    const origins = screen.getByRole("heading", { name: "Origins" }).nextElementSibling;
    expect(origins).toHaveTextContent("Forest");
    expect(origins).toHaveTextContent("Volcano");
    expect(screen.getByText(/^Copies the cards into your library\./)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Import to my library" }));

    const copy = await waitFor(() => {
      const added = contentStore.groups.find((candidate) => candidate.name === "Beasts (2)");
      expect(added).toBeDefined();
      return added;
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/cards");
    });
    expect(router.state.location.search).toBe(`?group=${copy?.id ?? ""}`);
    expect(await screen.findByRole("heading", { name: "Cards · Beasts (2)" })).toBeInTheDocument();
  });

  it("says when the content is the user's own", async () => {
    addDeck("Embers", volcano, [], CODE);
    await openImport();

    expect(screen.getByText("Deck by alice")).toBeInTheDocument();
    expect(screen.getByText("This is yours: importing makes a copy.")).toBeInTheDocument();
  });

  it("previews a rule set without an import button", async () => {
    const strict = contentStore.rulesets.find((ruleset) => ruleset.id === STRICT_RULESET_ID);
    if (strict !== undefined) strict.share_code = CODE;
    await openImport();

    expect(screen.getByRole("heading", { name: "Strict" })).toBeInTheDocument();
    expect(screen.getByText("Rule set by alice")).toBeInTheDocument();
    expect(
      screen.getByText("Rule sets can be imported once the rules editor is ready."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import to my library" })).not.toBeInTheDocument();
  });

  it("says when a link doesn't work", async () => {
    saveSession();
    renderApp("/share/NOPE234567");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This link doesn't work any more. It may have been revoked, or the deck or group deleted.",
    );
    expect(screen.getByRole("link", { name: "Go to the dashboard" })).toHaveAttribute("href", "/");
  });

  it("says the link doesn't work when it's revoked before the import", async () => {
    const { deck } = seedBobsDeck();
    const { user } = await openImport();
    deck.shareCode = null;

    await user.click(screen.getByRole("button", { name: "Import to my library" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This link doesn't work any more.");
    expect(contentStore.decks).toHaveLength(1);
  });
});
