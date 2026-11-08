/** The router state that `ProtectedRoute` sets when it sends a logged-out user to /login. */
export interface FromState {
  from: string;
}

/** The page to return to after login. Only a path inside this app is accepted. */
export function readFrom(state: unknown): string | null {
  if (typeof state !== "object" || state === null || !("from" in state)) return null;
  const { from } = state;
  if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//")) return null;
  return from;
}

/** The same state to pass on, so moving between /login and /register keeps the return page. */
export function keepFrom(state: unknown): FromState | null {
  const from = readFrom(state);
  return from === null ? null : { from };
}
