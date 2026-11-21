import { useNow } from "@/ui/useNow";
import { useGameStore } from "@/ws/gameStore";

import { awayRemainingMs, formatCountdown } from "./countdown";

interface AwayCountdownProps {
  name: string;
  /** When they left, in the server's Unix ms. */
  awaySince: number;
}

/** An opponent who left a running game, and how long they have to come back before they lose. */
export function AwayCountdown({ name, awaySince }: AwayCountdownProps) {
  const now = useNow(1000);
  const clockOffset = useGameStore((state) => state.clockOffset);
  const remaining = awayRemainingMs(awaySince, now, clockOffset);

  // Not a live region: it would announce every second.
  return (
    <p className="rounded-md border border-border-strong bg-surface-raised px-4 py-2">
      {name} left the game. They lose in{" "}
      <span className="font-mono tabular-nums">{formatCountdown(remaining)}</span> unless they come
      back.
    </p>
  );
}
