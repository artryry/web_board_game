import { http, HttpResponse } from "msw";

import type { Card } from "@/api/hooks/useCards";
import type { CardGroup } from "@/api/hooks/useCardGroups";
import type { Origin } from "@/api/hooks/useOrigins";

import {
  authorOf,
  byManaThenName,
  contentStore,
  deckOut,
  groupOut,
  newId,
  newShareCode,
  type FakeDeck,
} from "./contentStore";
import { apiError, apiUrl, authorized } from "./handlers";
import { noContent, type IdParams } from "./handlerUtils";
import { rulesetNotFound, rulesetReadOnly, rulesetShareTarget } from "./rulesetHandlers";

// Share codes, previews and imports over the in-memory store. The import is a simplified fork of
// the server's (backend services/share_service.py): custom origins are copied once, the cards get
// new ids, and a deck's cards land in a new group named after it.

interface CodeParams {
  code: string;
}

type Shared =
  | { kind: "deck"; deck: FakeDeck }
  | { kind: "card_group"; group: Omit<CardGroup, "card_count"> }
  | { kind: "ruleset"; ruleset: (typeof contentStore.rulesets)[number] };

const shareNotFound = () =>
  apiError(404, "share_not_found", "No deck, card group or ruleset has this share code");

/** The server reads codes without case or surrounding spaces. */
const normalized = (code: string) => code.trim().toUpperCase();

function findShared(code: string): Shared | null {
  const deck = contentStore.decks.find((candidate) => candidate.shareCode === code);
  if (deck !== undefined) return { kind: "deck", deck };
  const group = contentStore.groups.find((candidate) => candidate.share_code === code);
  if (group !== undefined) return { kind: "card_group", group };
  const ruleset = contentStore.rulesets.find((candidate) => candidate.share_code === code);
  if (ruleset !== undefined) return { kind: "ruleset", ruleset };
  return null;
}

function originOf(card: Card): Origin | undefined {
  return contentStore.origins.find((origin) => origin.id === card.origin_id);
}

function groupCards(groupId: string): Card[] {
  return contentStore.cards.filter((card) => card.group_id === groupId).sort(byManaThenName);
}

function preview(shared: Shared, code: string) {
  if (shared.kind === "deck") {
    const deck = deckOut(shared.deck);
    const origin = contentStore.origins.find((candidate) => candidate.id === deck.origin_id);
    return {
      kind: "deck",
      code,
      name: deck.name,
      author: authorOf(deck.id),
      origin,
      cards: deck.cards,
      card_count: deck.card_count,
    };
  }
  if (shared.kind === "card_group") {
    const cards = groupCards(shared.group.id);
    const origins = [...new Set(cards.map(originOf))]
      .filter((origin) => origin !== undefined)
      .sort((a, b) => Number(b.is_system) - Number(a.is_system) || a.name.localeCompare(b.name));
    return {
      kind: "card_group",
      code,
      name: shared.group.name,
      author: authorOf(shared.group.id),
      origins,
      cards: cards.map((card) => ({ card, count: 1 })),
      card_count: cards.length,
    };
  }
  const { ruleset } = shared;
  return {
    kind: "ruleset",
    code,
    name: ruleset.name,
    author: authorOf(ruleset.id),
    definition: ruleset.definition,
  };
}

/** The first free group name: the name itself, or "name (2)", "name (3)" and so on. */
function freeGroupName(name: string): string {
  const taken = (candidate: string) =>
    contentStore.groups.some((group) => group.name.toLowerCase() === candidate.toLowerCase());
  let candidate = name;
  for (let n = 2; taken(candidate); n += 1) candidate = `${name} (${n})`;
  return candidate;
}

function newGroup(name: string): string {
  const group = {
    id: newId(),
    name: freeGroupName(name),
    share_code: null,
    created_at: "2026-11-10T12:00:00Z",
    updated_at: "2026-11-10T12:00:00Z",
  };
  contentStore.groups.push(group);
  return group.id;
}

/** Copies the cards into a group, copying each custom origin once. Returns the id mappings. */
function copyCards(cards: readonly Card[], groupId: string) {
  const originIds = new Map<string, string>();
  const cardIds = new Map<string, string>();
  for (const card of cards) {
    const origin = originOf(card);
    if (origin !== undefined && !origin.is_system && !originIds.has(origin.id)) {
      const copy = { ...origin, id: newId() };
      contentStore.origins.push(copy);
      originIds.set(origin.id, copy.id);
    }
    const copy = {
      ...card,
      id: newId(),
      origin_id: originIds.get(card.origin_id) ?? card.origin_id,
      group_id: groupId,
    };
    contentStore.cards.unshift(copy);
    cardIds.set(card.id, copy.id);
  }
  return { originIds, cardIds };
}

function importShared(shared: Shared) {
  if (shared.kind === "deck") {
    const source = shared.deck;
    const cards = deckOut(source).cards.map((entry) => entry.card);
    // An empty deck makes no group.
    const copied =
      cards.length === 0
        ? { originIds: new Map<string, string>(), cardIds: new Map<string, string>() }
        : copyCards(cards, newGroup(source.name));
    const deck: FakeDeck = {
      id: newId(),
      name: source.name,
      originId: copied.originIds.get(source.originId) ?? source.originId,
      cards: source.cards.map((entry) => ({
        cardId: copied.cardIds.get(entry.cardId) ?? entry.cardId,
        count: entry.count,
      })),
      shareCode: null,
    };
    contentStore.decks.unshift(deck);
    return { kind: "deck", deck: deckOut(deck) };
  }
  if (shared.kind === "card_group") {
    const groupId = newGroup(shared.group.name);
    copyCards(groupCards(shared.group.id), groupId);
    const group = contentStore.groups.find((candidate) => candidate.id === groupId);
    return { kind: "card_group", group: group === undefined ? null : groupOut(group) };
  }
  const ruleset = {
    ...shared.ruleset,
    id: newId(),
    is_system: false,
    system_key: null,
    share_code: null,
  };
  contentStore.rulesets.push(ruleset);
  return { kind: "ruleset", ruleset };
}

interface ShareTarget {
  shareCode: string | null;
  /** The default ruleset: it can't be shared or revoked. */
  readOnly?: boolean;
}

/** Share and revoke for one kind: sharing again returns the same code, revoking always works. */
function shareRoutes(
  path: string,
  find: (id: string) => ShareTarget | undefined,
  notFound: () => Response,
) {
  return [
    http.post<IdParams>(
      apiUrl(`${path}/:id/share`),
      authorized<IdParams, Response>(({ params }) => {
        const target = find(params.id);
        if (target === undefined) return notFound();
        if (target.readOnly === true) return rulesetReadOnly();
        target.shareCode ??= newShareCode();
        return HttpResponse.json({ share_code: target.shareCode });
      }),
    ),
    http.delete<IdParams>(
      apiUrl(`${path}/:id/share`),
      authorized<IdParams, Response>(({ params }) => {
        const target = find(params.id);
        if (target === undefined) return notFound();
        if (target.readOnly === true) return rulesetReadOnly();
        target.shareCode = null;
        return noContent();
      }),
    ),
  ];
}

/** Lets `shareRoutes` read and write a group's `share_code` like a deck's `shareCode`. */
function groupShareTarget(id: string) {
  const group = contentStore.groups.find((candidate) => candidate.id === id);
  if (group === undefined) return undefined;
  return {
    get shareCode() {
      return group.share_code;
    },
    set shareCode(code: string | null) {
      group.share_code = code;
    },
  };
}

export const shareHandlers = [
  ...shareRoutes(
    "/api/decks",
    (id) => contentStore.decks.find((deck) => deck.id === id),
    () => apiError(404, "deck_not_found", "Deck not found"),
  ),
  ...shareRoutes("/api/card-groups", groupShareTarget, () =>
    apiError(404, "group_not_found", "Card group not found"),
  ),
  ...shareRoutes("/api/rulesets", rulesetShareTarget, rulesetNotFound),
  http.get<CodeParams>(
    apiUrl("/api/share/:code"),
    authorized<CodeParams, Response>(({ params }) => {
      const code = normalized(params.code);
      const shared = findShared(code);
      return shared === null ? shareNotFound() : HttpResponse.json(preview(shared, code));
    }),
  ),
  http.post<CodeParams>(
    apiUrl("/api/share/:code/import"),
    authorized<CodeParams, Response>(({ params }) => {
      const shared = findShared(normalized(params.code));
      return shared === null
        ? shareNotFound()
        : HttpResponse.json(importShared(shared), { status: 201 });
    }),
  ),
];
