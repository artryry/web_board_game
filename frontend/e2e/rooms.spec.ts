import { expect, test, type Page } from "@playwright/test";

import { dashboardHeading, registerNewUser } from "./helpers.ts";
import { seedDecks, seedSmallRuleset } from "./seed.ts";

// Two users meet in a room, each in their own browser context, against the real API and game
// socket. The content comes from the REST API (seed.ts); the decks have their own spec.

// Two registrations, the seeding and a whole lobby: more than the default 30 s against the dev
// server, which serves the app unbundled.
test.describe.configure({ timeout: 90_000 });

const RULES = "E2E small";

/** The host creates a room on the dashboard with `rules`, and returns its code. */
async function createRoom(page: Page, rules: string): Promise<string> {
  await page.getByRole("link", { name: "Create room" }).click();
  await page.getByRole("radio", { name: rules }).check();
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByRole("heading", { name: /^Room [0-9A-Z]{6}$/ })).toBeVisible();
  return page.getByLabel("Room code").inputValue();
}

/** Waits until the socket has the room: the lobby's controls turn on. */
async function lobbyIsLive(page: Page) {
  await expect(page.getByRole("button", { name: /^(Leave|Close room)$/ })).toBeEnabled();
}

test("two players meet by code, pick decks, start a game and finish it", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  try {
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    const hostAccount = await registerNewUser(host);
    const guestAccount = await registerNewUser(guest);
    await seedSmallRuleset(host.request, hostAccount, RULES);
    await seedDecks(host.request, hostAccount, { playable: "Host deck" });
    await seedDecks(guest.request, guestAccount, { playable: "Grove", refused: "Too small" });

    const code = await createRoom(host, RULES);
    await lobbyIsLive(host);
    await expect(host.getByText(`Rule set: ${RULES}`)).toBeVisible();

    // The guest joins with the code, typed in lower case.
    await guest.getByRole("button", { name: "Join by code" }).click();
    await guest.getByLabel("Room code").fill(code.toLowerCase());
    await guest.getByRole("button", { name: "Join", exact: true }).click();
    await expect(guest.getByRole("heading", { name: `Room ${code}` })).toBeVisible();
    await lobbyIsLive(guest);
    const guestSlot = host
      .getByRole("list", { name: "Players" })
      .getByRole("listitem", { name: guestAccount.username });
    await expect(guestSlot).toContainText("Online");

    // The refused deck says why; the playable one is picked. The server's answer checks it, so
    // the radio changes after the click, not with it.
    const refused = guest.getByRole("radio", { name: /^Too small/ });
    await expect(refused).toBeDisabled();
    await expect(refused).toHaveAccessibleDescription("3 of 10 cards");
    const grove = guest.getByRole("radio", { name: /^Grove/ });
    await grove.click();
    await expect(grove).toBeChecked();
    await expect(guestSlot).toContainText("Deck chosen");
    const hostDeck = host.getByRole("radio", { name: /^Host deck/ });
    await hostDeck.click();
    await expect(hostDeck).toBeChecked();

    await host.getByRole("button", { name: "I'm ready" }).click();
    await expect(host.getByRole("button", { name: "I'm ready" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await guest.getByRole("button", { name: "I'm ready" }).click();

    await expect(host.getByRole("heading", { name: "Game in progress" })).toBeVisible();
    await expect(guest.getByRole("heading", { name: "Game in progress" })).toBeVisible();
    // Exactly one of them plays first.
    const firsts = [host, guest].map((page) => page.getByText("You play first"));
    const counts = await Promise.all(firsts.map((first) => first.count()));
    expect(counts.sort()).toEqual([0, 1]);

    await host.getByRole("button", { name: "Surrender" }).click();
    await host
      .getByRole("dialog", { name: "Surrender?" })
      .getByRole("button", { name: "Surrender" })
      .click();
    await expect(host.getByRole("heading", { name: "You lost" })).toBeVisible();
    await expect(host.getByText("You surrendered.")).toBeVisible();
    await expect(guest.getByRole("heading", { name: "You won" })).toBeVisible();
    await expect(guest.getByText(`${hostAccount.username} surrendered.`)).toBeVisible();

    // A reload of the finished room still shows the result.
    await guest.reload();
    await expect(guest.getByRole("heading", { name: "You won" })).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("the invite link joins at once, and the guest can leave and come back", async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  try {
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    await registerNewUser(host);
    const guestAccount = await registerNewUser(guest);

    const code = await createRoom(host, "Default");
    const link = await host.getByLabel("Link").inputValue();
    expect(link).toMatch(new RegExp(`/room/${code}$`));

    await guest.goto(link);
    await expect(guest.getByRole("heading", { name: `Room ${code}` })).toBeVisible();
    await lobbyIsLive(guest);
    const players = host.getByRole("list", { name: "Players" });
    await expect(players.getByRole("listitem", { name: guestAccount.username })).toBeVisible();

    await guest.getByRole("button", { name: "Leave" }).click();
    await expect(dashboardHeading(guest, guestAccount.username)).toBeVisible();
    await expect(host.getByText("Waiting for a player. Share the code or the link.")).toBeVisible();

    await guest.goto(link);
    await lobbyIsLive(guest);
    await expect(players.getByRole("listitem", { name: guestAccount.username })).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
