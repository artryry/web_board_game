// The mana-cost suggestion, mirrored from backend/app/engine/cost.py (backend_plan §7.8) so the
// editor can update it as the user types, without a request. Its tests run the backend's own
// cases (backend/tests/fixtures/cost_cases.json). The balance label isn't copied: the library
// shows the server's.

import { MANA_MIN } from "@/api/bounds";
import type { CardKind } from "@/api/hooks/useCards";
import type { components } from "@/api/schema";

type CostSpec = components["schemas"]["CostSpec"];

/** A number from a form input. Empty or invalid inputs count as 0, like the server's `hp or 0`. */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** An ability's cost from its catalog spec: `base + Σ weight × params[name]`. */
export function abilityCost(cost: CostSpec, params: Readonly<Record<string, unknown>>): number {
  let total = cost.base;
  for (const [name, weight] of Object.entries(cost.per_param ?? {})) {
    total += weight * Math.trunc(count(params[name]));
  }
  return total;
}

/** Budget points of a card. A spell counts `|dmg|`, so healing 3 costs the same as 3 damage. */
export function cardPoints(
  kind: CardKind,
  hp: number | null,
  dmg: number | null,
  abilityCosts: readonly number[],
): number {
  const abilities = abilityCosts.reduce((sum, cost) => sum + cost, 0);
  if (kind === "creature") return count(hp) + count(dmg) + abilities;
  return Math.abs(count(dmg)) + abilities;
}

/**
 * `ceil((points - 1) / 2)`, at least 0. There is no upper cap: above the highest legal cost it
 * tells the author the card is stronger than any cost.
 */
export function suggestManaCost(points: number): number {
  return Math.max(MANA_MIN, Math.ceil((points - 1) / 2));
}
