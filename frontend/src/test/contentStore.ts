import type { Card } from "@/api/hooks/useCards";
import type { CardGroup } from "@/api/hooks/useCardGroups";
import type { Deck, DeckSummary } from "@/api/hooks/useDecks";
import type { Origin } from "@/api/hooks/useOrigins";
import type { Ruleset } from "@/api/hooks/useRulesets";
import { cardContent, suggestedCost } from "@/features/cards/cardValues";

import { CATALOG } from "./catalogFixture";
import { TEST_USER } from "./handlers";
import { rulesetsFixture } from "./rulesetFixture";

// The fake API's data: a small in-memory library, reset after every test (src/test/setup.ts).
// Tests seed it with the add* helpers and read what was saved, or what was sent, back from it.

const NOW = "2026-11-10T10:00:00Z";
export const ART_PUBLIC_ORIGIN = "https://art.test";

export interface FakeDeckCard {
  cardId: string;
  count: number;
}

export interface FakeDeck {
  id: string;
  name: string;
  originId: string;
  cards: FakeDeckCard[];
  shareCode: string | null;
}

interface SentRequest {
  method: string;
  path: string;
  body: unknown;
}

interface ContentStore {
  origins: Origin[];
  /** Newest first, like the API's list. */
  cards: Card[];
  groups: Omit<CardGroup, "card_count">[];
  /** Newest first, like the API's list. */
  decks: FakeDeck[];
  rulesets: Ruleset[];
  /** Who shared a deck, group or ruleset, by its id, when it isn't the test user. */
  authors: Map<string, string>;
  /** Upload keys and the Content-Type each was signed for. */
  signed: Map<string, string>;
  /** Keys whose file reached the fake R2. */
  stored: Set<string>;
  /** Every body the content handlers received, oldest first. */
  requests: SentRequest[];
  nextId: number;
}

export const SYSTEM_ORIGIN_IDS = {
  neutral: "10000000-0000-4000-8000-000000000001",
  forest: "10000000-0000-4000-8000-000000000002",
  volcano: "10000000-0000-4000-8000-000000000003",
  ocean: "10000000-0000-4000-8000-000000000004",
  mountain: "10000000-0000-4000-8000-000000000005",
};

function systemOrigin(
  key: keyof typeof SYSTEM_ORIGIN_IDS,
  name: string,
  color: Origin["color"],
  icon: Origin["icon"],
  fieldEffects: Origin["field_effects"],
): Origin {
  return {
    id: SYSTEM_ORIGIN_IDS[key],
    name,
    color,
    icon,
    field_effects: fieldEffects,
    background_art_key: null,
    background_art_url: null,
    is_system: true,
    system_key: key,
    created_at: NOW,
    updated_at: NOW,
  };
}

function emptyStore(): ContentStore {
  return {
    origins: [
      systemOrigin("neutral", "Neutral", "grey", "circle", []),
      systemOrigin("forest", "Forest", "bluish_green", "leaf", [
        { key: "stat_bonus", params: { applies_to: "own_origin", hp: 1, dmg: 0 } },
      ]),
      systemOrigin("volcano", "Volcano", "vermillion", "flame", [
        { key: "stat_bonus", params: { applies_to: "own_origin", hp: 0, dmg: 1 } },
      ]),
      systemOrigin("ocean", "Ocean", "blue", "waves", [{ key: "free_move", params: {} }]),
      systemOrigin("mountain", "Mountain", "orange", "mountain", [
        { key: "section_hp_bonus", params: { amount: 5 } },
      ]),
    ],
    cards: [],
    groups: [],
    decks: [],
    rulesets: rulesetsFixture(),
    authors: new Map(),
    signed: new Map(),
    stored: new Set(),
    requests: [],
    nextId: 1,
  };
}

export const contentStore: ContentStore = emptyStore();

export function resetContentStore(): void {
  Object.assign(contentStore, emptyStore());
}

export function newId(): string {
  const id = contentStore.nextId;
  contentStore.nextId += 1;
  return `20000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
}

export function artUrl(key: string | null): string | null {
  return key === null ? null : `${ART_PUBLIC_ORIGIN}/${key}`;
}

/** The last body sent with `method` to a path that starts with `path`. */
export function lastBody(method: string, path: string): unknown {
  return contentStore.requests.findLast(
    (request) => request.method === method && request.path.startsWith(path),
  )?.body;
}

export function addOrigin(fields: Partial<Origin> & { name: string }): Origin {
  const origin: Origin = {
    id: newId(),
    color: "sky_blue",
    icon: "star",
    field_effects: [],
    background_art_key: null,
    background_art_url: null,
    is_system: false,
    system_key: null,
    created_at: NOW,
    updated_at: NOW,
    ...fields,
  };
  contentStore.origins.push(origin);
  return origin;
}

/** Fills the server's derived fields: the suggestion, the balance label and the art URL. */
export function withDerived(card: Card): Card {
  const suggested = suggestedCost(
    cardContent(
      {
        kind: card.kind,
        hp: card.hp ?? 0,
        dmg: Math.abs(card.dmg ?? 0),
        abilities: card.abilities,
      },
      CATALOG,
    ),
    CATALOG,
  );
  const balance =
    card.mana_cost < suggested ? "under" : card.mana_cost > suggested ? "over" : "balanced";
  return { ...card, suggested_mana_cost: suggested, balance, art_url: artUrl(card.art_key) };
}

export function addCard(fields: Partial<Card> & { name: string }): Card {
  const card = withDerived({
    id: newId(),
    kind: "creature",
    origin_id: SYSTEM_ORIGIN_IDS.neutral,
    mana_cost: 1,
    hp: 1,
    dmg: 1,
    abilities: [],
    group_id: null,
    art_key: null,
    art_url: null,
    suggested_mana_cost: 0,
    balance: "balanced",
    created_at: NOW,
    updated_at: NOW,
    ...fields,
  });
  contentStore.cards.unshift(card);
  return card;
}

export function addGroup(name: string): CardGroup {
  const group = { id: newId(), name, share_code: null, created_at: NOW, updated_at: NOW };
  contentStore.groups.push(group);
  return groupOut(group);
}

export function groupOut(group: Omit<CardGroup, "card_count">): CardGroup {
  const count = contentStore.cards.filter((card) => card.group_id === group.id).length;
  return { ...group, card_count: count };
}

/** A deck, newest first. A card given by its id alone has one copy. */
export function addDeck(
  name: string,
  originId: string,
  cards: readonly (string | FakeDeckCard)[] = [],
  shareCode: string | null = null,
): FakeDeck {
  const deck: FakeDeck = {
    id: newId(),
    name,
    originId,
    cards: cards.map((card) => (typeof card === "string" ? { cardId: card, count: 1 } : card)),
    shareCode,
  };
  contentStore.decks.unshift(deck);
  return deck;
}

/** A share code in the server's alphabet (no 0, 1, I, L or O), unique within a test. */
export function newShareCode(): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let n = contentStore.nextId;
  contentStore.nextId += 1;
  let code = "";
  for (let i = 0; i < 10; i += 1) {
    code += alphabet[n % alphabet.length] ?? "2";
    n = Math.floor(n / alphabet.length);
  }
  return code;
}

/** The username shown as the author of a shared deck, group or ruleset. */
export function authorOf(id: string): string {
  return contentStore.authors.get(id) ?? TEST_USER.username;
}

/** Sorts deck cards as the server does: by mana cost, then name, then id. */
export function byManaThenName(a: Card, b: Card): number {
  return (
    a.mana_cost - b.mana_cost ||
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
    a.id.localeCompare(b.id)
  );
}

export function deckSummary(deck: FakeDeck): DeckSummary {
  return {
    id: deck.id,
    name: deck.name,
    origin_id: deck.originId,
    card_count: deck.cards.reduce((total, entry) => total + entry.count, 0),
    share_code: deck.shareCode,
    created_at: NOW,
    updated_at: NOW,
  };
}

export function deckOut(deck: FakeDeck): Deck {
  const cards = deck.cards
    .flatMap(({ cardId, count }) => {
      const card = contentStore.cards.find((candidate) => candidate.id === cardId);
      return card === undefined ? [] : [{ card, count }];
    })
    .sort((a, b) => byManaThenName(a.card, b.card));
  return { ...deckSummary(deck), cards };
}
