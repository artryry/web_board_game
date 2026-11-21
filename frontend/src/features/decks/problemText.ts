import type { RoomDeckProblem } from "@/api/hooks/useRooms";

import type { DeckProblem } from "./deckProblems";

/**
 * A deck problem in words, the same in the deck builder's rules check and the lobby's deck list:
 * "12 of 30 cards", "More than 2 copies: Wolf, Bear", "Neutral cards not allowed: Squire".
 */
export function deckProblemText(problem: DeckProblem): string {
  switch (problem.kind) {
    case "size":
      return `${problem.count} of ${problem.size} cards`;
    case "copies":
      return `More than ${problem.max} copies: ${problem.cards.join(", ")}`;
    case "neutral":
      return `Neutral cards not allowed: ${problem.cards.join(", ")}`;
  }
}

/** A problem from the server, which names its cards as `{id, name}`, in the builder's shape. */
export function fromRoomProblem(problem: RoomDeckProblem): DeckProblem {
  if (problem.kind === "size") return problem;
  return { ...problem, cards: problem.cards.map((card) => card.name) };
}
