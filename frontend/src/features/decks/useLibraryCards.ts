import { useOriginCards, type Card } from "@/api/hooks/useCards";

import { byCostThenName } from "./deckEntries";

/**
 * The cards a deck of `originId` can hold: that origin's and the neutral ones (only the neutral
 * ones for a neutral deck), by cost and name. Undefined while they load, or before an origin is
 * picked (`originId` is "").
 */
export function useLibraryCards(originId: string, neutralId: string) {
  const picked = originId !== "";
  const own = useOriginCards(picked ? originId : undefined);
  const neutral = useOriginCards(picked && originId !== neutralId ? neutralId : undefined);
  const lists = originId === neutralId ? [own] : [own, neutral];

  const error = lists.find((list) => list.error !== null)?.error ?? null;
  const loaded = lists.map((list) => list.data);
  let cards: Card[] | undefined;
  if (picked && loaded.every((data): data is Card[] => data !== undefined)) {
    cards = loaded.flat().sort(byCostThenName);
  }
  return { cards, error };
}
