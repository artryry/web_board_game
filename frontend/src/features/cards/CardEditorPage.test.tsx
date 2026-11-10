import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { addCard, addDeck, contentStore, lastBody, SYSTEM_ORIGIN_IDS } from "@/test/contentStore";
import { renderApp, saveSession } from "@/test/renderApp";

async function openEditor(path: string, heading: string) {
  saveSession();
  const view = renderApp(path);
  await screen.findByRole("heading", { name: heading });
  return view;
}

async function setNumber(user: UserEvent, label: string, value: string) {
  const input = screen.getByLabelText(label);
  await user.clear(input);
  await user.type(input, value);
}

function suggestion() {
  return screen.getByText(/Suggested cost:/);
}

describe("CardEditorPage", () => {
  it("updates the suggestion from the stats and the ability's params, then saves", async () => {
    const { user, router } = await openEditor("/cards/new", "New card");
    // A 1/1 creature: 2 points → 1 mana.
    expect(suggestion()).toHaveTextContent("Suggested cost: 1");

    await setNumber(user, "HP", "5");
    expect(suggestion()).toHaveTextContent("Suggested cost: 3");

    await user.selectOptions(screen.getByLabelText("Add ability"), "Armor");
    await setNumber(user, "Amount", "3");
    // 5 + 1 + armor 3 = 9 points → 4 mana.
    expect(suggestion()).toHaveTextContent("Suggested cost: 4");

    await user.type(screen.getByLabelText("Name"), "Ironbark");
    await user.click(screen.getByRole("button", { name: "Create card" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/cards");
    });
    expect(lastBody("POST", "/api/cards")).toEqual({
      kind: "creature",
      name: "Ironbark",
      origin_id: SYSTEM_ORIGIN_IDS.neutral,
      mana_cost: 1,
      hp: 5,
      dmg: 1,
      abilities: [{ key: "armor", params: { amount: 3 } }],
      group_id: null,
      art_key: null,
    });
  });

  it("fills in the suggestion capped at 10, and says when no legal cost is enough", async () => {
    const { user } = await openEditor("/cards/new", "New card");

    await setNumber(user, "HP", "99");
    await setNumber(user, "DMG", "99");
    expect(suggestion()).toHaveTextContent("Suggested cost: 99");
    expect(screen.getByText(/stronger than any legal cost/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use suggested" }));
    expect(screen.getByLabelText("Mana cost")).toHaveValue(10);
  });

  it("saves a cost that differs from the suggestion", async () => {
    const { user } = await openEditor("/cards/new", "New card");

    await setNumber(user, "HP", "5");
    await setNumber(user, "Mana cost", "9");
    await user.type(screen.getByLabelText("Name"), "Overpriced");
    await user.click(screen.getByRole("button", { name: "Create card" }));

    await waitFor(() => {
      expect(lastBody("POST", "/api/cards")).toMatchObject({ mana_cost: 9, hp: 5 });
    });
  });

  it("shows a spell's DMG by its effect, and sends a heal as a negative number", async () => {
    const { user } = await openEditor("/cards/new", "New card");

    await user.click(screen.getByLabelText("Spell"));
    expect(screen.queryByLabelText("HP")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("DMG")).not.toBeInTheDocument();

    const effect = screen.getByLabelText("Effect");
    await user.selectOptions(effect, "Deal damage");
    expect(screen.getByLabelText("Damage")).toBeInTheDocument();
    await user.selectOptions(effect, "Draw cards");
    expect(screen.queryByLabelText("Damage")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Heal")).not.toBeInTheDocument();

    await user.selectOptions(effect, "Heal");
    await setNumber(user, "Heal", "3");
    // |−3| + heal's base 1 = 4 points → 2 mana.
    expect(suggestion()).toHaveTextContent("Suggested cost: 2");
    await user.type(screen.getByLabelText("Name"), "Mend");
    await user.click(screen.getByRole("button", { name: "Create card" }));

    await waitFor(() => {
      expect(lastBody("POST", "/api/cards")).toMatchObject({
        kind: "spell",
        hp: null,
        dmg: -3,
        abilities: [{ key: "heal", params: { target: "creature" } }],
      });
    });
  });

  it("sends no DMG for an effect that doesn't use it", async () => {
    const { user } = await openEditor("/cards/new", "New card");

    await user.click(screen.getByLabelText("Spell"));
    await user.selectOptions(screen.getByLabelText("Effect"), "Draw cards");
    await user.type(screen.getByLabelText("Name"), "Insight");
    await user.click(screen.getByRole("button", { name: "Create card" }));

    await waitFor(() => {
      expect(lastBody("POST", "/api/cards")).toMatchObject({
        kind: "spell",
        hp: null,
        dmg: null,
        abilities: [{ key: "draw_cards", params: { count: 1 } }],
      });
    });
  });

  it("needs an effect before a spell can be saved", async () => {
    const { user } = await openEditor("/cards/new", "New card");

    await user.click(screen.getByLabelText("Spell"));
    await user.type(screen.getByLabelText("Name"), "Nothing");
    await user.click(screen.getByRole("button", { name: "Create card" }));

    expect(await screen.findByText("Choose an effect.")).toBeInTheDocument();
    expect(lastBody("POST", "/api/cards")).toBeUndefined();
  });

  it("sends hp: null when a creature becomes a spell", async () => {
    const wolf = addCard({
      name: "Wolf",
      hp: 3,
      dmg: 2,
      abilities: [{ key: "taunt", params: {} }],
    });
    const { user, router } = await openEditor(`/cards/${wolf.id}`, "Edit Wolf");

    await user.click(screen.getByLabelText("Spell"));
    await user.selectOptions(screen.getByLabelText("Effect"), "Deal damage");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/cards");
    });
    expect(lastBody("PATCH", `/api/cards/${wolf.id}`)).toEqual({
      kind: "spell",
      name: "Wolf",
      origin_id: SYSTEM_ORIGIN_IDS.neutral,
      mana_cost: 1,
      hp: null,
      dmg: 2,
      abilities: [{ key: "deal_damage", params: { target: "enemy_creature" } }],
      group_id: null,
      art_key: null,
    });
  });

  it("creates an origin in a modal and selects it", async () => {
    const { user } = await openEditor("/cards/new", "New card");

    await user.click(screen.getByRole("button", { name: "New origin" }));
    const dialog = screen.getByRole("dialog", { name: "New origin" });
    await user.type(within(dialog).getByLabelText("Name"), "Swamp");
    await user.click(within(dialog).getByRole("button", { name: "Create origin" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText("Origin")).toHaveDisplayValue("Swamp");
  });

  it("lists the decks that still hold a card it can't delete", async () => {
    const wolf = addCard({ name: "Wolf" });
    addDeck("Pack", SYSTEM_ORIGIN_IDS.neutral, [wolf.id]);
    const { user } = await openEditor(`/cards/${wolf.id}`, "Edit Wolf");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Wolf?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await within(dialog).findByText("Pack")).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("still hold this card");
  });

  it("lists the decks that block moving a card to another origin", async () => {
    const wolf = addCard({ name: "Wolf", origin_id: SYSTEM_ORIGIN_IDS.forest });
    addDeck("Forest pack", SYSTEM_ORIGIN_IDS.forest, [wolf.id]);
    const { user } = await openEditor(`/cards/${wolf.id}`, "Edit Wolf");

    await user.selectOptions(screen.getByLabelText("Origin"), "Volcano");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("of another origin hold this card");
    expect(within(alert).getByText("Forest pack")).toBeInTheDocument();
  });

  it("deletes a card and goes back to the library view it came from", async () => {
    const wolf = addCard({ name: "Wolf" });
    saveSession();
    const { user, router } = renderApp("/cards?kind=creature");

    await user.click(await screen.findByRole("link", { name: "Edit Wolf" }));
    await screen.findByRole("heading", { name: "Edit Wolf" });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete Wolf?" })).getByRole("button", {
        name: "Delete",
      }),
    );

    await waitFor(() => {
      expect(router.state.location.search).toBe("?kind=creature");
    });
    expect(await screen.findByText("No cards here yet.")).toBeInTheDocument();
    expect(contentStore.cards.some((card) => card.id === wolf.id)).toBe(false);
  });
});
