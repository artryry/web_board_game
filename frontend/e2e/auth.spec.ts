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
  const login = page.waitForResponse((response) => response.url().endsWith("/api/auth/login"));
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(dashboardHeading(page, account.username)).toBeVisible();

  // The browser's request id goes through nginx and comes back, so both sides log the same id.
  const answer = await login;
  const sentId = await answer.request().headerValue("X-Request-ID");
  expect(sentId).toMatch(/^[0-9a-f-]{32,36}$/);
  expect(await answer.headerValue("X-Request-ID")).toBe(sentId);

  // A reload keeps the session.
  await page.reload();
  await expect(dashboardHeading(page, account.username)).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => refreshCookie(page)).toBeUndefined();
  expect(await page.evaluate(() => localStorage.getItem("cardtable.session"))).toBeNull();
});
