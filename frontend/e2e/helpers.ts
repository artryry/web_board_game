import { expect, type Page } from "@playwright/test";

// Users made by the e2e tests stay in the dev DB. They all start with "e2e_", so one statement
// removes them and, by cascade, everything they made:
// DELETE FROM users WHERE username LIKE 'e2e\_%';
export function newAccount() {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const username = `e2e_${suffix}`;
  return { username, email: `${username}@example.com`, password: `pw-${suffix}-secret` };
}

export function dashboardHeading(page: Page, username: string) {
  return page.getByRole("heading", { name: `Welcome, ${username}` });
}

/** Registers a fresh `e2e_` user and waits for the dashboard. */
export async function registerNewUser(page: Page) {
  const account = newAccount();
  await page.goto("/register");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(dashboardHeading(page, account.username)).toBeVisible();
  return account;
}

/**
 * Creates a 1/1 creature for 1 mana in the card editor, and waits for the library. It starts from
 * the main nav, so the app isn't reloaded.
 */
export async function createCard(page: Page, card: { name: string; origin: string }) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Cards" }).click();
  await page.getByRole("link", { name: "New card" }).click();
  await page.getByLabel("Name", { exact: true }).fill(card.name);
  await page.getByLabel("Origin", { exact: true }).selectOption({ label: card.origin });
  await page.getByRole("button", { name: "Create card" }).click();
  await expect(page).toHaveURL(/\/cards$/);
}
