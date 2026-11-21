import { isRecord } from "@/api/errors";

// The last room this browser joined, for the dashboard's "Back to room". It's stored with the
// user's id, so another user on the same browser never gets it: opening it would join them.

export const LAST_ROOM_KEY = "cardtable.lastRoom";

export function rememberRoom(userId: string, code: string): void {
  try {
    localStorage.setItem(LAST_ROOM_KEY, JSON.stringify({ user_id: userId, code }));
  } catch {
    // Storage can be blocked (private mode, site data off): there's just no Back to room.
  }
}

/** The last room's code, when this user joined it. */
export function lastRoomFor(userId: string): string | null {
  const stored = readLastRoom();
  return stored !== null && stored.user_id === userId ? stored.code : null;
}

/** Forgets the last room if it's this one, so a newer room joined elsewhere stays. */
export function forgetRoom(code: string): void {
  if (readLastRoom()?.code !== code) return;
  try {
    localStorage.removeItem(LAST_ROOM_KEY);
  } catch {
    // Nothing was stored if storage is blocked.
  }
}

function readLastRoom(): { user_id: string; code: string } | null {
  try {
    const raw = localStorage.getItem(LAST_ROOM_KEY);
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!isRecord(value)) return null;
    const { user_id: userId, code } = value;
    return typeof userId === "string" && typeof code === "string"
      ? { user_id: userId, code }
      : null;
  } catch {
    // Blocked storage, or a value that isn't ours: no last room.
    return null;
  }
}
