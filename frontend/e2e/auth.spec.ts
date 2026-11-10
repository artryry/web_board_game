import { expect, test, type Page } from "@playwright/test";

import { dashboardHeading, registerNewUser } from "./helpers.ts";

async function refreshCookie(page: Page) {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === "refresh_token");
}

test("register, log out, log in and log out again", async ({ page }) => {
  const account = await registerNewUser(page);

  await expect(page.getByRole("banner")).toContainText(account.username);
  await expect(page).toHaveURL(/^http:\/\/[^/]+\/$/);

  // The refresh token is an HttpOnly cookie that only the auth routes receive.
  expect(await refreshCookie(page)).toMatchObject({
    httpOnly: true,
    sameSite: "Strict",
    path: "/api/auth",
  });
  expect(await page.evaluate(() => document.cookie)).not.toContain("refresh_token");

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();

  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(dashboardHeading(page, account.username)).toBeVisible();

  // A reload keeps the session.
  await page.reload();
  await expect(dashboardHeading(page, account.username)).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => refreshCookie(page)).toBeUndefined();
  expect(await page.evaluate(() => localStorage.getItem("cardtable.session"))).toBeNull();
});
