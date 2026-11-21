import { DISCONNECT_FORFEIT_MS } from "@/ws/socket";

/**
 * How long a player who left a game has before they lose, in ms, never below 0. `awaySince` is
 * the server's time; `clockOffset` (the server's clock minus ours) turns `now` into it.
 */
export function awayRemainingMs(awaySince: number, now: number, clockOffset: number): number {
  return Math.max(0, awaySince + DISCONNECT_FORFEIT_MS - (now + clockOffset));
}

/** "0:42": minutes and seconds, rounded up, so the clock shows 0:00 only at the end. */
export function formatCountdown(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
