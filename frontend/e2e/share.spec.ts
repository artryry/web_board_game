import { expect, test, type Locator } from "@playwright/test";

import { createCard, dragOnto, registerNewUser } from "./helpers.ts";

// Sharing between two users, each in their own browser context (their own cookies and session),
// against the real API. Like content.spec.ts it uploads no art; copied art is checked by hand.

const DECK_PATH = /\/decks\/[0-9a-f-]{36}$/;

// Two users, two registrations and two library flows: more than the default 30 s against the
// dev server, which serves the app unbundled.
test.describe.configure({ timeout: 60_000 });

/** Creates the share link in the open share dialog and returns it. */
async function createLink(dialog: Locator) {
  await dialog.getByRole("button", { name: "Create link" }).click();
  const link = dialog.getByLabel("Link");
  await expect(link).toHaveValue(/\/share\/[0-9A-Z]{10}$/);
  return link.inputValue();
}

test("a deck built by dragging and shared by one user is imported by another", async ({
  browser,
}) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  try {
    const alice = await aliceContext.newPage();
    const author = await registerNewUser(alice);
    await createCard(alice, { name: "Moss wolf", origin: "Forest" });
    await createCard(alice, { name: "Bark bear", origin: "Forest" });

    // Build the deck: one card dragged, one clicked.
    await alice
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Decks" })
      .click();
    await alice.getByRole("link", { name: "New deck" }).click();
    await alice.getByLabel("Name", { exact: true }).fill("E2E Grove");
    await alice.getByLabel("Origin", { exact: true }).selectOption({ label: "Forest" });
    const deck = alice.getByRole("region", { name: /^Deck ·/ });
    await dragOnto(alice, alice.getByRole("button", { name: "Add Moss wolf" }), deck);
    await expect(deck).toHaveAccessibleName("Deck · 1 card");
    await alice.getByRole("button", { name: "Add Bark bear" }).click();
    await expect(deck).toHaveAccessibleName("Deck · 2 cards");
    await alice.getByRole("button", { name: "Save" }).click();
    await expect(alice).toHaveURL(DECK_PATH);
    await expect(alice.getByRole("heading", { name: "Edit E2E Grove" })).toBeVisible();

    await alice.getByRole("button", { name: "Share" }).click();
    const link = await createLink(alice.getByRole("dialog", { name: "Share E2E Grove" }));

    // Bob previews the deck and imports a copy.
    const bob = await bobContext.newPage();
    await registerNewUser(bob);
    await bob.goto(link);
    await expect(bob.getByRole("heading", { name: "E2E Grove" })).toBeVisible();
    await expect(bob.getByText(`Deck by ${author.username}`)).toBeVisible();
    await expect(bob.getByRole("article", { name: "Moss wolf" })).toBeVisible();
    await bob.getByRole("button", { name: "Import to my library" }).click();

    await expect(bob).toHaveURL(DECK_PATH);
    await expect(bob.getByRole("heading", { name: "Edit E2E Grove" })).toBeVisible();
    await expect(bob.getByRole("region", { name: /^Deck ·/ })).toHaveAccessibleName(
      "Deck · 2 cards",
    );
    expect(new URL(bob.url()).pathname).not.toBe(new URL(alice.url()).pathname);
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test("a card group shared by one user is imported by another", async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  try {
    const alice = await aliceContext.newPage();
    const author = await registerNewUser(alice);
    await createCard(alice, { name: "Moss wolf", origin: "Forest" });

    // A group with the card in it, shared from the card library.
    const groups = alice.getByRole("navigation", { name: "Groups" });
    await alice.getByRole("button", { name: "New group" }).click();
    await alice.getByRole("dialog", { name: "New group" }).getByLabel("Name").fill("E2E Pack");
    await alice.getByRole("button", { name: "Create group" }).click();
    await alice.getByRole("button", { name: "Move… Moss wolf to a group" }).click();
    const move = alice.getByRole("dialog", { name: "Move Moss wolf" });
    await move.getByLabel("E2E Pack").check();
    await move.getByRole("button", { name: "Move" }).click();
    await expect(groups.getByRole("link", { name: "E2E Pack 1 card" })).toBeVisible();
    await groups.getByRole("button", { name: "Share E2E Pack" }).click();
    const dialog = alice.getByRole("dialog", { name: "Share E2E Pack" });
    const link = await createLink(dialog);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(groups.getByRole("link", { name: "E2E Pack (shared) 1 card" })).toBeVisible();

    // Bob imports it and lands on the new group in his library.
    const bob = await bobContext.newPage();
    await registerNewUser(bob);
    await bob.goto(link);
    await expect(bob.getByText(`Card group by ${author.username}`)).toBeVisible();
    await bob.getByRole("button", { name: "Import to my library" }).click();

    await expect(bob).toHaveURL(/\/cards\?group=[0-9a-f-]{36}$/);
    await expect(bob.getByRole("heading", { name: "Cards · E2E Pack" })).toBeVisible();
    await expect(bob.getByRole("article", { name: "Moss wolf" })).toBeVisible();
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});
