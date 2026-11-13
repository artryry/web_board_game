import { http, HttpResponse } from "msw";

import { MAX_COPIES, MAX_DECK_SIZE } from "@/api/bounds";

import {
  contentStore,
  deckOut,
  deckSummary,
  newId,
  SYSTEM_ORIGIN_IDS,
  type FakeDeck,
  type FakeDeckCard,
} from "./contentStore";
import { apiError, apiUrl, authorized } from "./handlers";
import { noContent, pageOf, readBody, type Body, type IdParams } from "./handlerUtils";

// Decks over the in-memory store. A deck save is checked the way the server checks it (backend
// services/deck_service.py), in the same order, so the builder's error paths can be tested;
// ruleset deck rules are never checked on save.

const deckNotFound = () => apiError(404, "deck_not_found", "Deck not found");

function readDeckCards(value: unknown): FakeDeckCard[] | null {
  if (!Array.isArray(value)) return null;
  const cards = value as { card_id?: unknown; count?: unknown }[];
  const valid = cards.every(
    (entry) =>
      typeof entry.card_id === "string" &&
      typeof entry.count === "number" &&
      entry.count >= 1 &&
      entry.count <= MAX_COPIES,
  );
  if (!valid || cards.length > MAX_DECK_SIZE) return null;
  return cards.map((entry) => ({ cardId: String(entry.card_id), count: Number(entry.count) }));
}

/** The server's answer to a deck it won't save, or null when the deck is fine. */
function deckProblem(originId: string, cards: readonly FakeDeckCard[]) {
  if (!contentStore.origins.some((origin) => origin.id === originId)) {
    return apiError(422, "invalid_origin", "Use one of your origins or a system origin");
  }
  const ids = cards.map((entry) => entry.cardId);
  if (new Set(ids).size !== ids.length) {
    return apiError(
      422,
      "invalid_deck_cards",
      "List each card once, with its number of copies in `count`",
    );
  }
  if (cards.reduce((total, entry) => total + entry.count, 0) > MAX_DECK_SIZE) {
    return apiError(422, "deck_too_large", `A deck holds at most ${MAX_DECK_SIZE} cards`);
  }
  const held = ids.map((id) => contentStore.cards.find((card) => card.id === id));
  const found = held.filter((card) => card !== undefined);
  if (found.length !== ids.length) {
    return apiError(422, "invalid_deck_cards", "A deck can only hold your own cards");
  }
  const misfits = found
    .filter((card) => card.origin_id !== originId && card.origin_id !== SYSTEM_ORIGIN_IDS.neutral)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  if (misfits.length > 0) {
    return apiError(
      422,
      "card_origin_mismatch",
      `${misfits.length} card(s) are neither of the deck's origin nor neutral`,
      { cards: misfits.map(({ id, name }) => ({ id, name })) },
    );
  }
  return null;
}

/** The body's fields over the current deck (or a new one), or null for a malformed body. */
function mergedDeck(body: Body, current: FakeDeck | undefined): FakeDeck | null {
  const cards = body.cards === undefined ? (current?.cards ?? []) : readDeckCards(body.cards);
  const name = body.name === undefined ? current?.name : body.name;
  const originId = body.origin_id === undefined ? current?.originId : body.origin_id;
  if (cards === null || typeof name !== "string" || typeof originId !== "string") return null;
  if (name.trim() === "") return null;
  return {
    id: current?.id ?? newId(),
    name: name.trim(),
    originId,
    cards,
    shareCode: current?.shareCode ?? null,
  };
}

const invalidBody = () => apiError(422, "validation_error", "Invalid deck");

export const deckHandlers = [
  http.get(
    apiUrl("/api/decks"),
    authorized(({ request }) => pageOf(contentStore.decks.map(deckSummary), request)),
  ),
  http.get<IdParams>(
    apiUrl("/api/decks/:id"),
    authorized<IdParams, Response>(({ params }) => {
      const deck = contentStore.decks.find((candidate) => candidate.id === params.id);
      return deck === undefined ? deckNotFound() : HttpResponse.json(deckOut(deck));
    }),
  ),
  http.post(
    apiUrl("/api/decks"),
    authorized(async ({ request }) => {
      const deck = mergedDeck(await readBody(request), undefined);
      if (deck === null) return invalidBody();
      const problem = deckProblem(deck.originId, deck.cards);
      if (problem !== null) return problem;
      contentStore.decks.unshift(deck);
      return HttpResponse.json(deckOut(deck), { status: 201 });
    }),
  ),
  http.patch<IdParams>(
    apiUrl("/api/decks/:id"),
    authorized<IdParams, Promise<Response>>(async ({ request, params }) => {
      const body = await readBody(request);
      const index = contentStore.decks.findIndex((deck) => deck.id === params.id);
      const current = contentStore.decks[index];
      if (current === undefined) return deckNotFound();
      const deck = mergedDeck(body, current);
      if (deck === null) return invalidBody();
      const problem = deckProblem(deck.originId, deck.cards);
      if (problem !== null) return problem;
      contentStore.decks[index] = deck;
      return HttpResponse.json(deckOut(deck));
    }),
  ),
  http.delete<IdParams>(
    apiUrl("/api/decks/:id"),
    authorized<IdParams, Response>(({ params }) => {
      if (!contentStore.decks.some((deck) => deck.id === params.id)) return deckNotFound();
      contentStore.decks = contentStore.decks.filter((deck) => deck.id !== params.id);
      return noContent();
    }),
  ),
];
