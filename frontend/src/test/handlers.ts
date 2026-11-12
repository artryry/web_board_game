import { http, HttpResponse } from "msw";

import { apiOrigin } from "@/api/client";
import type { components } from "@/api/schema";

type User = components["schemas"]["UserOut"];

/** A full API URL, as the client requests it. */
export function apiUrl(path: string): string {
  return `${apiOrigin()}${path}`;
}

export const TEST_USER: User = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "alice",
  email: "alice@example.com",
  created_at: "2026-11-06T10:00:00Z",
};
export const TEST_PASSWORD = "correct-horse";

// The fake server hands out these access tokens: login and register the first, a refresh the
// second. The refresh cookie is the browser's business, and Node's fetch keeps no cookies, so
// the fake refresh always succeeds. A test that needs it to fail overrides the handler.
export const FIRST_ACCESS = "access-1";
export const REFRESHED_ACCESS = "access-2";
const VALID_ACCESS = new Set([FIRST_ACCESS, REFRESHED_ACCESS]);

export const LIBRARY_TOTALS = { cards: 12, cardGroups: 3, decks: 2 };

/**
 * An error answer in the API's shape, with any `extra` fields next to the code (such as a 409's
 * lists). Every 401 carries `WWW-Authenticate`, as on the server.
 */
export function apiError(
  status: number,
  code: string,
  message = code,
  extra: Record<string, unknown> = {},
) {
  const headers: Record<string, string> = status === 401 ? { "WWW-Authenticate": "Bearer" } : {};
  return HttpResponse.json({ detail: { code, message, ...extra } }, { status, headers });
}

function bearerOf(request: Request): string | null {
  const header = request.headers.get("Authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

interface ResolverInfo<P> {
  request: Request;
  params: P;
}

/** Answers like the real API when the request carries a valid access token. */
export function authorized<P, T>(answer: (info: ResolverInfo<P>) => T) {
  return (info: ResolverInfo<P>) => {
    const token = bearerOf(info.request);
    if (token === null) return apiError(401, "not_authenticated");
    if (!VALID_ACCESS.has(token)) return apiError(401, "token_invalid");
    return answer(info);
  };
}

/** A list answer that only counts. */
export function page(total: number) {
  return () => HttpResponse.json({ items: [], total });
}

export const handlers = [
  http.post(apiUrl("/api/auth/login"), async ({ request }) => {
    const body = (await request.json()) as components["schemas"]["LoginRequest"];
    if (body.email !== TEST_USER.email || body.password !== TEST_PASSWORD) {
      return apiError(401, "invalid_credentials", "Wrong email or password");
    }
    return HttpResponse.json({ access: FIRST_ACCESS });
  }),

  http.post(apiUrl("/api/auth/register"), async ({ request }) => {
    const body = (await request.json()) as components["schemas"]["RegisterRequest"];
    if (body.username === "taken") {
      return apiError(409, "username_taken", "This username is already taken");
    }
    if (body.email === "taken@example.com") {
      return apiError(409, "email_taken", "An account with this email already exists");
    }
    return HttpResponse.json({ access: FIRST_ACCESS }, { status: 201 });
  }),

  http.post(apiUrl("/api/auth/refresh"), () => HttpResponse.json({ access: REFRESHED_ACCESS })),
  http.post(apiUrl("/api/auth/logout"), () => new HttpResponse(null, { status: 204 })),

  http.get(
    apiUrl("/api/auth/me"),
    authorized(() => HttpResponse.json(TEST_USER)),
  ),
];
