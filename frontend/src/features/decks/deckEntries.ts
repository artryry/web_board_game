import { MAX_COPIES, MAX_DECK_SIZE } from "@/api/bounds";
import type { Card } from "@/api/hooks/useCards";
import type { DeckCardIn } from "@/api/hooks/useDecks";

// The deck builder's card list: pure functions over `{card, count}` rows, the shape the API's
// `DeckOut.cards` already has. Only the server's hard bounds apply here (1–4 copies, at most 60
// cards); a ruleset's deck rules are information only (deckProblems.ts).

export interface DeckEntry {
  card: Card;
  count: number;
}

/** Every copy counted. */
export function deckSize(entries: readonly DeckEntry[]): number {
  return entries.reduce((total, entry) => total + entry.count, 0);
}

export function copiesOf(entries: readonly DeckEntry[], cardId: string): number {
  return entries.find((entry) => entry.card.id === cardId)?.count ?? 0;
}

/** Whether one more copy fits the server's bounds. */
export function canAdd(entries: readonly DeckEntry[], cardId: string): boolean {
  return copiesOf(entries, cardId) < MAX_COPIES && deckSize(entries) < MAX_DECK_SIZE;
}

/** The server's order for deck cards: by mana cost, then name, then id. */
export function byCostThenName(a: Card, b: Card): number {
  return (
    a.mana_cost - b.mana_cost ||
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
    a.id.localeCompare(b.id)
  );
}

export function sortEntries(entries: readonly DeckEntry[]): DeckEntry[] {
  return [...entries].sort((a, b) => byCostThenName(a.card, b.card));
}

/** One more copy of the card, or the same list when it wouldn't fit. */
export function addCopy(entries: readonly DeckEntry[], card: Card): readonly DeckEntry[] {
  if (!canAdd(entries, card.id)) return entries;
  if (copiesOf(entries, card.id) === 0) return sortEntries([...entries, { card, count: 1 }]);
  return entries.map((entry) =>
    entry.card.id === card.id ? { ...entry, count: entry.count + 1 } : entry,
  );
}

/** One copy fewer; the last copy removes the row. */
export function removeCopy(entries: readonly DeckEntry[], cardId: string): readonly DeckEntry[] {
  return entries.flatMap((entry) => {
    if (entry.card.id !== cardId) return [entry];
    return entry.count > 1 ? [{ ...entry, count: entry.count - 1 }] : [];
  });
}

/** A deck holds cards of its own origin and neutral cards. A neutral deck holds neutral only. */
export function fitsOrigin(card: Card, originId: string, neutralId: string): boolean {
  return card.origin_id === originId || card.origin_id === neutralId;
}

/** The rows a change to `originId` would drop. */
export function cardsOutsideOrigin(
  entries: readonly DeckEntry[],
  originId: string,
  neutralId: string,
): DeckEntry[] {
  return entries.filter((entry) => !fitsOrigin(entry.card, originId, neutralId));
}

export function keepOrigin(
  entries: readonly DeckEntry[],
  originId: string,
  neutralId: string,
): DeckEntry[] {
  return entries.filter((entry) => fitsOrigin(entry.card, originId, neutralId));
}

/** The list a save sends: the whole deck, every time. */
export function toDeckCards(entries: readonly DeckEntry[]): DeckCardIn[] {
  return entries.map((entry) => ({ card_id: entry.card.id, count: entry.count }));
}

/** Whether two lists hold the same copies, whatever their order. */
export function sameCards(a: readonly DeckEntry[], b: readonly DeckEntry[]): boolean {
  return a.length === b.length && a.every((entry) => copiesOf(b, entry.card.id) === entry.count);
}
