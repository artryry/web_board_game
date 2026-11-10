import { expect, test } from "@playwright/test";

import { registerNewUser } from "./helpers.ts";

// One user's content from start to end, against the real API. It uploads no art, so it doesn't
// depend on R2 and leaves nothing in the bucket; art is checked by hand (current-feature.md).
test("create an origin and a card, sort it into a group, then delete both", async ({ page }) => {
  await registerNewUser(page);

  // An origin with a field effect.
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Origins" })
    .click();
  await page.getByRole("link", { name: "New origin" }).click();
  await page.getByLabel("Name", { exact: true }).fill("E2E Swamp");
  await page.getByText("Black", { exact: true }).click();
  await page.getByLabel("Add field effect").selectOption({ label: "Stat bonus" });
  await expect(page.getByRole("region", { name: "Preview" })).toContainText("Stat bonus");
  await page.getByRole("button", { name: "Create origin" }).click();
  await expect(page).toHaveURL(/\/origins$/);
  await expect(page.getByRole("heading", { name: "E2E Swamp" })).toBeVisible();

  // A creature with an ability; the suggestion follows its HP.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Cards" }).click();
  await page.getByRole("link", { name: "New card" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Bog troll");
  await page.getByLabel("Origin", { exact: true }).selectOption({ label: "E2E Swamp" });
  const suggestion = page.getByText(/Suggested cost:/);
  await expect(suggestion).toHaveText("Suggested cost: 1");
  await page.getByLabel("HP", { exact: true }).fill("5");
  await expect(suggestion).toHaveText("Suggested cost: 3");
  await page.getByLabel("Add ability").selectOption({ label: "Taunt" });
  // 5 HP + 1 DMG + taunt 2 = 8 points → 4 mana.
  await expect(suggestion).toHaveText("Suggested cost: 4");
  await page.getByRole("button", { name: "Use suggested" }).click();
  await expect(page.getByLabel("Mana cost")).toHaveValue("4");
  await page.getByRole("button", { name: "Create card" }).click();
  await expect(page).toHaveURL(/\/cards$/);

  // A group, and the card moved into it.
  const groups = page.getByRole("navigation", { name: "Groups" });
  await page.getByRole("button", { name: "New group" }).click();
  await page.getByRole("dialog", { name: "New group" }).getByLabel("Name").fill("E2E Beasts");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(groups.getByRole("link", { name: "E2E Beasts 0 cards" })).toBeVisible();

  await page.getByRole("button", { name: "Move… Bog troll to a group" }).click();
  const move = page.getByRole("dialog", { name: "Move Bog troll" });
  await move.getByLabel("E2E Beasts").check();
  await move.getByRole("button", { name: "Move" }).click();
  await expect(groups.getByRole("link", { name: "E2E Beasts 1 card" })).toBeVisible();

  // The group shows the card with its balance label.
  await groups.getByRole("link", { name: /^E2E Beasts/ }).click();
  await expect(page).toHaveURL(/\/cards\?group=/);
  const card = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("article", { name: "Bog troll" }) });
  await expect(card).toContainText("Balanced");
  await expect(card).toContainText("E2E Swamp");

  // Delete the card from its editor, which goes back to the group.
  await card.getByRole("link", { name: "Edit Bog troll" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("dialog", { name: "Delete Bog troll?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page).toHaveURL(/\/cards\?group=/);
  await expect(page.getByText("No cards here yet.")).toBeVisible();

  // Nothing uses the origin any more, so it can go too.
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Origins" })
    .click();
  await page.getByRole("button", { name: "Delete E2E Swamp" }).click();
  await page
    .getByRole("dialog", { name: "Delete E2E Swamp?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.getByRole("heading", { name: "E2E Swamp" })).toHaveCount(0);
});
