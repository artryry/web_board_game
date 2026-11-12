import type { DeckRules } from "@/api/hooks/useRulesets";

import { deckSize, type DeckEntry } from "./deckEntries";

// A deck checked against a ruleset's `deck` rules, as information only: saving never depends on
// it, and the server checks the deck again when it's picked for a room (backend M6).

export type DeckProblem =
  /** The deck needs exactly `size` cards. */
  | { kind: "size"; count: number; size: number }
  /** Cards with more than `max` copies, by name. */
  | { kind: "copies"; max: number; cards: string[] }
  /** Neutral cards in a deck of another origin, when the rules don't allow them. */
  | { kind: "neutral"; cards: string[] };

export function deckProblems(
  entries: readonly DeckEntry[],
  rules: DeckRules,
  origins: { deck: string; neutral: string },
): DeckProblem[] {
  const problems: DeckProblem[] = [];
  const count = deckSize(entries);
  if (count !== rules.size) problems.push({ kind: "size", count, size: rules.size });

  const overCopies = entries.filter((entry) => entry.count > rules.max_copies);
  if (overCopies.length > 0) {
    problems.push({
      kind: "copies",
      max: rules.max_copies,
      cards: overCopies.map((entry) => entry.card.name),
    });
  }

  // A neutral deck's cards are its own origin, so only a deck of another origin can break this.
  if (!rules.allow_neutral && origins.deck !== origins.neutral) {
    const neutral = entries.filter((entry) => entry.card.origin_id === origins.neutral);
    if (neutral.length > 0) {
      problems.push({ kind: "neutral", cards: neutral.map((entry) => entry.card.name) });
    }
  }
  return problems;
}
