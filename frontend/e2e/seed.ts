import { expect, type APIRequestContext } from "@playwright/test";

// Seeds a user's content through the REST API, for specs that need a playable deck without
// building one in the UI (the deck builder has its own spec). Content made here belongs to the
// e2e user, so the cleanup in helpers.ts removes it too.

interface Account {
  email: string;
  password: string;
}

interface Origin {
  id: string;
  system_key: string | null;
}

interface Ruleset {
  id: string;
  system_key: string | null;
  definition: { deck: { size: number; max_copies: number; allow_neutral: boolean } };
}

/** Logs in through the API and returns a client that sends the user's bearer token. */
async function asUser(request: APIRequestContext, account: Account) {
  const login = await request.post("/api/auth/login", {
    data: { email: account.email, password: account.password },
  });
  expect(login.ok()).toBe(true);
  const { access } = (await login.json()) as { access: string };
  const headers = { Authorization: `Bearer ${access}` };

  return {
    async get<T>(path: string): Promise<T> {
      const response = await request.get(path, { headers });
      expect(response.ok(), `GET ${path}`).toBe(true);
      return (await response.json()) as T;
    },
    async post<T>(path: string, data: unknown): Promise<T> {
      const response = await request.post(path, { headers, data });
      expect(response.ok(), `POST ${path}: ${await response.text()}`).toBe(true);
      return (await response.json()) as T;
    },
  };
}

/** The smallest decks the rules allow: 10 cards, up to 4 copies each. */
export const SMALL_RULES = { size: 10, max_copies: 4 };

/** A copy of the default rule set with `SMALL_RULES` decks, named `name`. */
export async function seedSmallRuleset(
  request: APIRequestContext,
  account: Account,
  name: string,
): Promise<void> {
  const api = await asUser(request, account);
  const { items } = await api.get<{ items: Ruleset[] }>("/api/rulesets?limit=100");
  const base = items.find((ruleset) => ruleset.system_key === "default");
  if (base === undefined) throw new Error("No default rule set");
  await api.post("/api/rulesets", {
    name,
    definition: { ...base.definition, deck: { ...base.definition.deck, ...SMALL_RULES } },
  });
}

/**
 * Three Forest creatures and a 10-card deck of them, `playable` under `SMALL_RULES`, and with
 * `refused` a 3-card deck that isn't.
 */
export async function seedDecks(
  request: APIRequestContext,
  account: Account,
  decks: { playable: string; refused?: string },
): Promise<void> {
  const api = await asUser(request, account);
  const { items: origins } = await api.get<{ items: Origin[] }>("/api/origins?limit=100");
  const forest = origins.find((origin) => origin.system_key === "forest");
  if (forest === undefined) throw new Error("No Forest origin");

  const cards: string[] = [];
  for (const name of ["Moss wolf", "Bark bear", "Fern fox"]) {
    const card = await api.post<{ id: string }>("/api/cards", {
      kind: "creature",
      name,
      origin_id: forest.id,
      mana_cost: 1,
      hp: 1,
      dmg: 1,
    });
    cards.push(card.id);
  }
  const [wolf, bear, fox] = cards;
  await api.post("/api/decks", {
    name: decks.playable,
    origin_id: forest.id,
    cards: [
      { card_id: wolf, count: 4 },
      { card_id: bear, count: 4 },
      { card_id: fox, count: 2 },
    ],
  });
  if (decks.refused !== undefined) {
    await api.post("/api/decks", {
      name: decks.refused,
      origin_id: forest.id,
      cards: [{ card_id: wolf, count: 3 }],
    });
  }
}
