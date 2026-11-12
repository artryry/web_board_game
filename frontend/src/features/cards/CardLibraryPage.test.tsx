import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { addCard, addGroup, contentStore, lastBody, SYSTEM_ORIGIN_IDS } from "@/test/contentStore";
import { renderApp, saveSession } from "@/test/renderApp";

const { forest, volcano } = SYSTEM_ORIGIN_IDS;

/** Two forest creatures in "Beasts" and an ungrouped volcano spell, one per balance label. */
function seedLibrary() {
  const beasts = addGroup("Beasts");
  // 1/1 for 1: balanced. 5/5 for 1: under-costed (suggested 5).
  addCard({ name: "Wolf", origin_id: forest, group_id: beasts.id, hp: 1, dmg: 1, mana_cost: 1 });
  addCard({ name: "Bear", origin_id: forest, group_id: beasts.id, hp: 5, dmg: 5, mana_cost: 1 });
  // 3 damage + deal_damage's base 1 = 4 points, suggested 2, priced 5: over-costed.
  addCard({
    name: "Fireball",
    kind: "spell",
    origin_id: volcano,
    hp: null,
    dmg: 3,
    abilities: [{ key: "deal_damage", params: { target: "enemy_creature" } }],
    mana_cost: 5,
  });
  return { beasts };
}

async function openLibrary(path = "/cards") {
  saveSession();
  const view = renderApp(path);
  const panel = await screen.findByRole("navigation", { name: "Groups" });
  return { ...view, panel };
}

function shownCards(): string[] {
  const grid = screen.queryByRole("list", { name: "Cards" });
  if (grid === null) return [];
  return within(grid)
    .getAllByRole("article")
    .map((card) => card.getAttribute("aria-label") ?? "");
}

function libraryCard(name: string): HTMLElement {
  const card = screen.getByRole("article", { name }).closest("li");
  if (card === null) throw new Error(`No library card ${name}`);
  return card;
}

describe("CardLibraryPage", () => {
  it("lists the groups with their counts, and each card with its balance label", async () => {
    seedLibrary();
    const { panel } = await openLibrary();

    expect(await within(panel).findByRole("link", { name: "All cards 3 cards" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      await within(panel).findByRole("link", { name: "Ungrouped 1 card" }),
    ).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Beasts 2 cards" })).toBeInTheDocument();

    await waitFor(() => {
      expect(shownCards()).toEqual(["Fireball", "Bear", "Wolf"]);
    });
    expect(libraryCard("Wolf")).toHaveTextContent("Balanced");
    expect(libraryCard("Bear")).toHaveTextContent("Under-costed · suggested 5");
    expect(libraryCard("Fireball")).toHaveTextContent("Over-costed · suggested 2");
  });

  it("keeps the group and the filters in the URL", async () => {
    const { beasts } = seedLibrary();
    const { panel, user, router } = await openLibrary();

    await user.click(within(panel).getByRole("link", { name: /^Beasts/ }));
    await waitFor(() => {
      expect(shownCards()).toEqual(["Bear", "Wolf"]);
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Beasts");

    await user.selectOptions(screen.getByLabelText("Origin"), "Volcano");
    expect(await screen.findByText("No cards here yet.")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Kind"), "Spells");

    const query = new URLSearchParams(router.state.location.search);
    expect(Object.fromEntries(query)).toEqual({ group: beasts.id, origin: volcano, kind: "spell" });

    await user.click(within(panel).getByRole("link", { name: /^Ungrouped/ }));
    await waitFor(() => {
      expect(shownCards()).toEqual(["Fireball"]);
    });
  });

  it("opens with the view from a link", async () => {
    seedLibrary();
    await openLibrary(`/cards?origin=${forest}&kind=creature`);

    await waitFor(() => {
      expect(shownCards()).toEqual(["Bear", "Wolf"]);
    });
    expect(screen.getByLabelText("Origin")).toHaveDisplayValue("Forest");
    expect(screen.getByLabelText("Kind")).toHaveDisplayValue("Creatures");
  });

  it("starts a new card in the group and origin being shown, and comes back to them", async () => {
    const { beasts } = seedLibrary();
    const path = `/cards?group=${beasts.id}&origin=${forest}`;
    const { user, router } = await openLibrary(path);

    await user.click(screen.getByRole("link", { name: "New card" }));
    await screen.findByRole("heading", { name: "New card" });
    expect(screen.getByLabelText("Origin")).toHaveDisplayValue("Forest");
    expect(screen.getByLabelText("Group")).toHaveDisplayValue("Beasts");

    await user.click(screen.getByRole("link", { name: "Cancel" }));
    await waitFor(() => {
      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(path);
    });
  });

  it("creates, renames and deletes a group, keeping its cards", async () => {
    seedLibrary();
    const { panel, user } = await openLibrary();

    await user.click(screen.getByRole("button", { name: "New group" }));
    await user.type(
      within(screen.getByRole("dialog", { name: "New group" })).getByLabelText("Name"),
      "Spells",
    );
    await user.click(screen.getByRole("button", { name: "Create group" }));
    expect(await within(panel).findByRole("link", { name: "Spells 0 cards" })).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Rename Spells" }));
    const rename = screen.getByRole("dialog", { name: "Rename Spells" });
    await user.clear(within(rename).getByLabelText("Name"));
    await user.type(within(rename).getByLabelText("Name"), "beasts");
    await user.click(within(rename).getByRole("button", { name: "Rename" }));
    expect(
      await within(rename).findByText("You already have a group with this name"),
    ).toBeInTheDocument();
    expect(within(rename).getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");

    await user.clear(within(rename).getByLabelText("Name"));
    await user.type(within(rename).getByLabelText("Name"), "Magic");
    await user.click(within(rename).getByRole("button", { name: "Rename" }));
    expect(await within(panel).findByRole("link", { name: "Magic 0 cards" })).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Delete Beasts" }));
    const confirm = screen.getByRole("dialog", { name: "Delete Beasts?" });
    expect(confirm).toHaveTextContent("Its 2 cards stay in your library, without a group.");
    await user.click(within(confirm).getByRole("button", { name: "Delete group" }));

    await waitFor(() => {
      expect(within(panel).queryByRole("link", { name: /^Beasts/ })).not.toBeInTheDocument();
    });
    expect(
      await within(panel).findByRole("link", { name: "Ungrouped 3 cards" }),
    ).toBeInTheDocument();
    expect(contentStore.cards).toHaveLength(3);
  });

  it("moves a card to another group from the grid", async () => {
    const { beasts } = seedLibrary();
    const { panel, user } = await openLibrary();

    await user.click(await screen.findByRole("button", { name: "Move… Fireball to a group" }));
    const dialog = screen.getByRole("dialog", { name: "Move Fireball" });
    await user.click(within(dialog).getByLabelText("Beasts"));
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    const fireball = contentStore.cards.find((card) => card.name === "Fireball");
    expect(lastBody("PATCH", `/api/cards/${fireball?.id ?? ""}`)).toEqual({ group_id: beasts.id });
    expect(await within(panel).findByRole("link", { name: "Beasts 3 cards" })).toBeInTheDocument();
  });

  it("shares a group by code, and marks it as shared", async () => {
    const { beasts } = seedLibrary();
    const { user, panel } = await openLibrary();
    expect(await within(panel).findByRole("link", { name: "Beasts 2 cards" })).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Share Beasts" }));
    const dialog = screen.getByRole("dialog", { name: "Share Beasts" });
    await user.click(within(dialog).getByRole("button", { name: "Create link" }));

    const code = await waitFor(() => {
      const stored = contentStore.groups.find((group) => group.id === beasts.id)?.share_code;
      expect(stored).toEqual(expect.any(String));
      return stored ?? "";
    });
    expect(await within(dialog).findByText(code)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(
      await within(panel).findByRole("link", { name: "Beasts (shared) 2 cards" }),
    ).toBeInTheDocument();
  });

  it("loads more cards 50 at a time", async () => {
    for (let index = 1; index <= 55; index += 1) addCard({ name: `Card ${index}` });
    const { user } = await openLibrary();

    await waitFor(() => {
      expect(shownCards()).toHaveLength(50);
    });
    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(shownCards()).toHaveLength(55);
    });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});
