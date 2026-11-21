import type { EndReason, Seat } from "@/ws/messages";

// A finished game in words, for the player in `mySeat`. `winner` null is a draw.

export function resultHeadline(winner: Seat | null, mySeat: Seat): string {
  if (winner === null) return "Draw";
  return winner === mySeat ? "You won" : "You lost";
}

export function resultReason(
  reason: EndReason,
  winner: Seat | null,
  mySeat: Seat,
  opponent: string,
): string {
  const iWon = winner === mySeat;
  switch (reason) {
    case "conquered":
      return "Sections conquered.";
    case "surrender":
      return iWon ? `${opponent} surrendered.` : "You surrendered.";
    case "out_of_cards":
      return "Both players ran out of cards.";
    case "abandoned":
      return iWon ? `${opponent} left the game.` : "You were away too long.";
  }
}
