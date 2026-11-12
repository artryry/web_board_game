import type { DeckEntry } from "./deckEntries";

/** Costs from this one up share the last bar ("7+"). */
export const CURVE_TOP = 7;

export interface CurveBar {
  label: string;
  count: number;
}

/** How many cards cost 0, 1, … 6, and 7 or more, every copy counted. */
export function manaCurve(entries: readonly DeckEntry[]): CurveBar[] {
  const counts = Array.from({ length: CURVE_TOP + 1 }, () => 0);
  for (const { card, count } of entries) {
    const bar = Math.min(card.mana_cost, CURVE_TOP);
    counts[bar] = (counts[bar] ?? 0) + count;
  }
  return counts.map((count, cost) => ({
    label: cost === CURVE_TOP ? `${CURVE_TOP}+` : String(cost),
    count,
  }));
}
