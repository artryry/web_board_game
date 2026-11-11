/**
 * The session as this page's scripts see it. The access token lives only in memory. The refresh
 * token is an HttpOnly cookie: the browser keeps it and sends it to /api/auth itself, and no
 * script can read it. localStorage holds only a hint that a session exists, which isn't secret:
 * it lets a reload skip the refresh call when nobody is logged in, and removing it tells the
 * other tabs about a logout.
 */

import { log } from "@/log/logger";

export const SESSION_HINT_KEY = "cardtable.session";

/** Why a session ended: the user logged out (here or in another tab), or it couldn't be renewed. */
export type SessionEndReason = "logout" | "expired";

type SessionEndListener = (reason: SessionEndReason) => void;

let accessToken: string | null = null;
// Bumped on every session end, so work that started before it can tell it is stale.
let generation = 0;
const listeners = new Set<SessionEndListener>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function storeAccessToken(token: string): void {
  accessToken = token;
  try {
    localStorage.setItem(SESSION_HINT_KEY, "1");
  } catch {
    // Without storage the session still works in this tab until a reload.
  }
}

/** Whether a login left a session that a reload can restore from the refresh cookie. */
export function hasSavedSession(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) !== null;
  } catch {
    // Storage can be blocked (private mode, site data off): there is just no saved session.
    return false;
  }
}

export function getGeneration(): number {
  return generation;
}

/** Ends the session in this tab. Deleting the refresh cookie is the server's job (`logout`). */
export function endSession(reason: SessionEndReason): void {
  if (reason === "expired") log.info("auth.session_expired");
  accessToken = null;
  generation += 1;
  try {
    localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Nothing was stored if storage is blocked.
  }
  for (const listener of listeners) listener(reason);
}

export function onSessionEnd(listener: SessionEndListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Logs this tab out when another tab removes the session hint (or clears the storage). */
export function listenToOtherTabs(): () => void {
  const onStorage = (event: StorageEvent) => {
    const removed =
      event.key === null || (event.key === SESSION_HINT_KEY && event.newValue === null);
    if (removed) endSession("logout");
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
  };
}
