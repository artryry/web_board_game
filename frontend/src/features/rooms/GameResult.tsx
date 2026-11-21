import { ButtonLink } from "@/ui/ButtonLink";
import type { GameResult as Outcome } from "@/ws/gameStore";
import type { Seat } from "@/ws/messages";

import { resultHeadline, resultReason } from "./resultText";

interface GameResultProps {
  outcome: Outcome;
  mySeat: Seat;
  opponent: string;
}

/** How the game ended, for this player. F5's GameOverModal takes its place. */
export function GameResult({ outcome, mySeat, opponent }: GameResultProps) {
  return (
    <section
      aria-labelledby="result-title"
      className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center"
    >
      <h1 id="result-title" className="text-3xl font-semibold">
        {resultHeadline(outcome.winner, mySeat)}
      </h1>
      <p className="text-lg">{resultReason(outcome.reason, outcome.winner, mySeat, opponent)}</p>
      <ButtonLink to="/">Back to the dashboard</ButtonLink>
      <p className="text-sm text-text-muted">The room closes 10 minutes after the game.</p>
    </section>
  );
}
