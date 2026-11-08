import createClient from "openapi-fetch";

import { endSession, getAccessToken, getGeneration, storeAccessToken } from "@/auth/tokens";

import { errorCode } from "./errors";
import type { paths } from "./schema";

/**
 * The API's origin. By default it is the page's own: nginx serves the app and /api together.
 * The refresh cookie is only sent to the page's own origin (fetch's default credentials).
 */
export function apiOrigin(): string {
  const configured = import.meta.env.VITE_API_ORIGIN;
  return configured !== undefined && configured !== "" ? configured : window.location.origin;
}

// These take no access token (refresh and logout use the refresh cookie), and their 401s are
// answers for the caller, not an ended session.
const AUTH_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/refresh",
  "/api/auth/logout",
]);

/**
 * Adds the bearer token to every request. When the server says `token_expired`, it renews the
 * session once (shared by parallel requests) and retries the request. Any other 401 ends the
 * session.
 */
async function authFetch(request: Request): Promise<Response> {
  if (AUTH_PATHS.has(new URL(request.url).pathname)) return fetch(request);

  const retry = request.clone();
  const sentToken = getAccessToken();
  const response = await fetch(withBearer(request, sentToken));
  if (response.status !== 401 || sentToken === null) return response;

  const code = errorCode(await readJson(response.clone()));
  if (code !== "token_expired") {
    endSession("expired");
    return response;
  }
  // Another request may have renewed the token while this one was out.
  if (getAccessToken() === sentToken && !(await refreshSession())) return response;

  const newToken = getAccessToken();
  return newToken === null ? response : fetch(withBearer(retry, newToken));
}

export const api = createClient<paths>({ baseUrl: apiOrigin(), fetch: authFetch });

let refreshing: Promise<boolean> | null = null;

/**
 * Trades the refresh cookie for a new access token; the answer also renews the cookie. Parallel
 * callers share one request. Resolves false when the session has ended. A network error is
 * thrown and keeps the session.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function doRefresh(): Promise<boolean> {
  const startedIn = getGeneration();
  const { data } = await api.POST("/api/auth/refresh");
  if (getGeneration() !== startedIn) {
    // A logout while we waited wins: don't keep a token that would log the user back in. The
    // answer also set a new refresh cookie, which would outlive the logout, so delete it again.
    if (data !== undefined) await clearRefreshCookie();
    return false;
  }
  if (data === undefined) {
    endSession("expired");
    return false;
  }
  storeAccessToken(data.access);
  return true;
}

/**
 * Asks the server to delete the refresh cookie, since scripts can't touch an HttpOnly cookie.
 * The session has already ended in this tab and the hint is gone, so a network error is only
 * logged: the cookie then stays until it expires or the next login replaces it.
 */
export async function clearRefreshCookie(): Promise<void> {
  try {
    await api.POST("/api/auth/logout");
  } catch (error) {
    console.warn("Couldn't delete the refresh cookie", error);
  }
}

function withBearer(request: Request, token: string | null): Request {
  if (token !== null) request.headers.set("Authorization", `Bearer ${token}`);
  return request;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // A 401 without a JSON body has no code; it is handled like any other 401.
    return null;
  }
}
