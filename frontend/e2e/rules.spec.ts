import { expect, test, type Page } from "@playwright/test";

import { dragOnto, registerNewUser } from "./helpers.ts";

// The rules editor against the real API: the server's checks show up as the rules change, and a
// saved rule set comes back as it was saved. The second test shares one with another user.

const RULES_PATH = /\/rules\/[0-9a-f-]{36}$/;

test.describe.configure({ timeout: 60_000 });

/** The rows of a pipeline ("Setup" or "Turn"), in order. */
function phaseRows(page: Page, pipeline: "Setup" | "Turn") {
  return page.getByRole("list", { name: pipeline, exact: true }).locator(":scope > li");
}

function turnOrder(page: Page) {
  return page.getByRole("list", { name: "Turn order" }).getByRole("listitem");
}

/** From the main nav, duplicates the default rule set and names the copy. */
async function duplicateDefault(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Rules" }).click();
  await page.getByRole("link", { name: "Duplicate Default" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Default copy");
  await page.getByLabel("Name", { exact: true }).fill(name);
}

test("the default rule set is duplicated, edited, checked and saved", async ({ page }) => {
  await registerNewUser(page);
  await duplicateDefault(page, "E2E Quick");
  await expect(page.getByText("No problems")).toBeVisible();

  await page.getByLabel("Lanes", { exact: true }).fill("4");
  await expect(
    page.getByRole("img", { name: "Board: 4 lanes, 3 slots per section" }),
  ).toBeVisible();

  // Break the turn, see the server's message, and fix it.
  await page.getByRole("button", { name: "Remove End turn" }).click();
  await expect(page.getByRole("list", { name: "Turn problems" })).toHaveText(
    "A turn must end with 'end_turn'",
  );
  await page.getByRole("button", { name: "Add End turn to Turn" }).click();
  await expect(page.getByText("No problems")).toBeVisible();

  // A new Draw lands before End turn; drag it to the top of the turn.
  await page.getByRole("button", { name: "Add Draw to Turn" }).click();
  await expect(turnOrder(page)).toHaveText([
    /Gain mana$/,
    /Draw$/,
    /Action phase$/,
    /Draw$/,
    /End turn$/,
  ]);
  const rows = phaseRows(page, "Turn");
  await dragOnto(page, rows.nth(3).locator("[data-drag-handle]"), rows.nth(0));
  await expect(turnOrder(page)).toHaveText([
    /Draw$/,
    /Gain mana$/,
    /Draw$/,
    /Action phase$/,
    /End turn$/,
  ]);

  // Give the action phase a longer time limit.
  const action = rows.nth(3);
  await action.getByRole("button", { name: "Action phase settings" }).click();
  await action.getByLabel("Time limit (s)").fill("120");
  await expect(action).toContainText("⏱ 120 s");
  await expect(page.getByText("No problems")).toBeVisible();

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(RULES_PATH);
  await expect(page.getByRole("heading", { name: "Edit E2E Quick" })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Lanes", { exact: true })).toHaveValue("4");
  await expect(turnOrder(page)).toHaveText([
    /Draw$/,
    /Gain mana$/,
    /Draw$/,
    /Action phase$/,
    /End turn$/,
  ]);
  await expect(phaseRows(page, "Turn").nth(3)).toContainText("⏱ 120 s");
});

test("a rule set shared by one user is imported by another", async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  try {
    const alice = await aliceContext.newPage();
    const author = await registerNewUser(alice);
    await duplicateDefault(alice, "E2E Shared rules");
    await alice.getByLabel("Lanes", { exact: true }).fill("5");
    await alice.getByRole("button", { name: "Save" }).click();
    await expect(alice).toHaveURL(RULES_PATH);

    await alice.getByRole("button", { name: "Share" }).click();
    const dialog = alice.getByRole("dialog", { name: "Share E2E Shared rules" });
    await dialog.getByRole("button", { name: "Create link" }).click();
    const linkField = dialog.getByLabel("Link");
    await expect(linkField).toHaveValue(/\/share\/[0-9A-Z]{10}$/);
    const link = await linkField.inputValue();

    const bob = await bobContext.newPage();
    await registerNewUser(bob);
    await bob.goto(link);
    await expect(bob.getByRole("heading", { name: "E2E Shared rules" })).toBeVisible();
    await expect(bob.getByText(`Rule set by ${author.username}`)).toBeVisible();
    await expect(bob.getByLabel("Lanes", { exact: true })).toHaveValue("5");
    await bob.getByRole("button", { name: "Import to my library" }).click();

    await expect(bob).toHaveURL(RULES_PATH);
    await expect(bob.getByRole("heading", { name: "Edit E2E Shared rules" })).toBeVisible();
    await expect(bob.getByLabel("Lanes", { exact: true })).toHaveValue("5");
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});
