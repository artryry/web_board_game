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
