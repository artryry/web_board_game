import { isRecord } from "@/api/errors";
import { log } from "@/log/logger";

/**
 * When an access token (a JWT) expires, in Unix ms, read from its payload without checking it:
 * only the server can do that. Null when the token isn't a JWT or has no `exp`, which the caller
 * treats as "use it as it is" (the server answers a bad token with 4401 anyway).
 */
export function tokenExpiresAt(token: string): number | null {
  const payload = token.split(".")[1];
  if (payload === undefined) return null;
  try {
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return isRecord(claims) && typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    // A token whose payload doesn't decode is still sent: the server decides.
    log.debug("auth.token_exp_unreadable");
    return null;
  }
}
