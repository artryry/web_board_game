import { http, HttpResponse } from "msw";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  endSession,
  getAccessToken,
  hasSavedSession,
  onSessionEnd,
  storeAccessToken,
  type SessionEndReason,
} from "@/auth/tokens";
import {
  apiError,
  apiUrl,
  FIRST_ACCESS,
  REFRESHED_ACCESS,
  TEST_PASSWORD,
  TEST_USER,
} from "@/test/handlers";
import { logged } from "@/test/logCapture";
import { server } from "@/test/server";

import { api, clearRefreshCookie } from "./client";
import { errorCode } from "./errors";

const EXPIRED_ACCESS = "access-expired";

/** `/me` says `token_expired` for the expired token and answers the refreshed one. */
function mockExpiringApi() {
  const calls = { refresh: 0 };
  server.use(
    http.post(apiUrl("/api/auth/refresh"), () => {
      calls.refresh += 1;
      return HttpResponse.json({ access: REFRESHED_ACCESS });
    }),
    http.get(apiUrl("/api/auth/me"), ({ request }) => {
      const authorization = request.headers.get("Authorization");
      if (authorization === `Bearer ${EXPIRED_ACCESS}`) return apiError(401, "token_expired");
      if (authorization === `Bearer ${REFRESHED_ACCESS}`) return HttpResponse.json(TEST_USER);
      return apiError(401, "token_invalid");
    }),
  );
  return calls;
}

function countLogouts() {
  const calls = { logout: 0 };
  server.use(
    http.post(apiUrl("/api/auth/logout"), () => {
      calls.logout += 1;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

function recordSessionEnds(): SessionEndReason[] {
  const reasons: SessionEndReason[] = [];
  onTestFinished(onSessionEnd((reason) => reasons.push(reason)));
  return reasons;
}

describe("api client", () => {
  it("sends the access token as a bearer header", async () => {
    storeAccessToken(FIRST_ACCESS);
    const seen: (string | null)[] = [];
    server.use(
      http.get(apiUrl("/api/auth/me"), ({ request }) => {
        seen.push(request.headers.get("Authorization"));
        return HttpResponse.json(TEST_USER);
      }),
    );

    const { data } = await api.GET("/api/auth/me");

    expect(seen).toEqual([`Bearer ${FIRST_ACCESS}`]);
    expect(data).toEqual(TEST_USER);
  });

  it("refreshes an expired token once, stores the new one and retries", async () => {
    storeAccessToken(EXPIRED_ACCESS);
    const calls = mockExpiringApi();

    const { data, response } = await api.GET("/api/auth/me");

    expect(response.status).toBe(200);
    expect(data).toEqual(TEST_USER);
    expect(calls.refresh).toBe(1);
    expect(getAccessToken()).toBe(REFRESHED_ACCESS);
    expect(hasSavedSession()).toBe(true);
  });

  it("shares one refresh between parallel requests", async () => {
    storeAccessToken(EXPIRED_ACCESS);
    const calls = mockExpiringApi();

    const results = await Promise.all([
      api.GET("/api/auth/me"),
      api.GET("/api/auth/me"),
      api.GET("/api/auth/me"),
    ]);

    expect(results.map((result) => result.response.status)).toEqual([200, 200, 200]);
    expect(calls.refresh).toBe(1);
  });

  it("retries without a refresh when another request already renewed the token", async () => {
    storeAccessToken(EXPIRED_ACCESS);
    const calls = mockExpiringApi();
    server.use(
      http.get(
        apiUrl("/api/auth/me"),
        () => {
          // Another request renews the session while this one is still out.
          storeAccessToken(REFRESHED_ACCESS);
          return apiError(401, "token_expired");
        },
        { once: true },
      ),
    );

    const { response } = await api.GET("/api/auth/me");

    expect(response.status).toBe(200);
    expect(calls.refresh).toBe(0);
  });

  it("ends the session when the refresh fails", async () => {
    storeAccessToken(EXPIRED_ACCESS);
    mockExpiringApi();
    server.use(http.post(apiUrl("/api/auth/refresh"), () => apiError(401, "token_invalid")));
    const reasons = recordSessionEnds();

    const { error, response } = await api.GET("/api/auth/me");

    expect(response.status).toBe(401);
    expect(errorCode(error)).toBe("token_expired");
    expect(reasons).toEqual(["expired"]);
    expect(getAccessToken()).toBeNull();
    expect(hasSavedSession()).toBe(false);
  });

  it("ends the session on any other 401 without trying a refresh", async () => {
    storeAccessToken("access-forged");
    const calls = mockExpiringApi();
    const reasons = recordSessionEnds();

    const { response } = await api.GET("/api/auth/me");

    expect(response.status).toBe(401);
    expect(calls.refresh).toBe(0);
    expect(reasons).toEqual(["expired"]);
  });

  it("keeps the session when a login is refused", async () => {
    storeAccessToken(FIRST_ACCESS);
    const calls = mockExpiringApi();
    const reasons = recordSessionEnds();

    const { error, response } = await api.POST("/api/auth/login", {
      body: { email: TEST_USER.email, password: `not-${TEST_PASSWORD}` },
    });

    expect(response.status).toBe(401);
    expect(errorCode(error)).toBe("invalid_credentials");
    expect(calls.refresh).toBe(0);
    expect(reasons).toEqual([]);
    expect(getAccessToken()).toBe(FIRST_ACCESS);
  });

  it("drops a refresh answer that arrives after a logout, and deletes its cookie", async () => {
    storeAccessToken(EXPIRED_ACCESS);
    mockExpiringApi();
    const logouts = countLogouts();
    server.use(
      http.post(apiUrl("/api/auth/refresh"), () => {
        endSession("logout");
        return HttpResponse.json({ access: REFRESHED_ACCESS });
      }),
    );

    const { response } = await api.GET("/api/auth/me");

    expect(response.status).toBe(401);
    expect(getAccessToken()).toBeNull();
    expect(hasSavedSession()).toBe(false);
    expect(logouts.logout).toBe(1);
  });

  it("doesn't throw when the cookie can't be deleted, and logs it", async () => {
    server.use(http.post(apiUrl("/api/auth/logout"), () => HttpResponse.error()));

    await expect(clearRefreshCookie()).resolves.toBeUndefined();
    const [entry] = logged("auth.logout_cookie_clear_failed");
    expect(entry?.level).toBe("warn");
    expect(entry?.error?.name).toBe("TypeError");
  });
});

describe("api client logging", () => {
  function recordRequestIds() {
    const ids: (string | null)[] = [];
    server.use(
      http.get(apiUrl("/api/auth/me"), ({ request }) => {
        ids.push(request.headers.get("X-Request-ID"));
        return HttpResponse.json(TEST_USER);
      }),
    );
    return ids;
  }

  it("sends a new request id with every request and logs each call", async () => {
    storeAccessToken(FIRST_ACCESS);
    const ids = recordRequestIds();

    await api.GET("/api/auth/me");
    await api.GET("/api/auth/me");

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const calls = logged("api.request");
    expect(calls.map((entry) => entry.fields)).toEqual(
      ids.map((id) => ({
        method: "GET",
        path: "/api/auth/me",
        request_id: id,
        status: 200,
        duration_ms: expect.any(Number) as number,
      })),
    );
    expect(calls.every((entry) => entry.level === "debug")).toBe(true);
  });

  it("gives a retry after a token refresh its own request id", async () => {
    storeAccessToken(EXPIRED_ACCESS);
    const ids: (string | null)[] = [];
    mockExpiringApi();
    server.events.on("request:start", ({ request }) => {
      if (new URL(request.url).pathname === "/api/auth/me") {
        ids.push(request.headers.get("X-Request-ID"));
      }
    });
    onTestFinished(() => {
      server.events.removeAllListeners();
    });

    await api.GET("/api/auth/me");

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("logs a server error as a warning with its code and request id", async () => {
    storeAccessToken(FIRST_ACCESS);
    const sent: (string | null)[] = [];
    server.use(
      http.get(apiUrl("/api/auth/me"), ({ request }) => {
        sent.push(request.headers.get("X-Request-ID"));
        return apiError(500, "internal_error");
      }),
    );

    await api.GET("/api/auth/me");

    const [entry] = logged("api.request_failed");
    expect(entry?.level).toBe("warn");
    expect(entry?.fields).toMatchObject({
      status: 500,
      code: "internal_error",
      path: "/api/auth/me",
      request_id: sent[0],
    });
  });

  it("logs a network failure as a warning", async () => {
    storeAccessToken(FIRST_ACCESS);
    server.use(http.get(apiUrl("/api/auth/me"), () => HttpResponse.error()));

    await expect(api.GET("/api/auth/me")).rejects.toThrow();

    const [entry] = logged("api.request_failed");
    expect(entry?.fields).toMatchObject({ network: true, method: "GET", path: "/api/auth/me" });
    expect(entry?.error?.name).toBe("TypeError");
  });

  it("doesn't log a 4xx answer as a failure", async () => {
    server.use(http.get(apiUrl("/api/auth/me"), () => apiError(404, "not_found")));
    storeAccessToken(FIRST_ACCESS);

    await api.GET("/api/auth/me");

    expect(logged("api.request_failed")).toEqual([]);
    expect(logged("api.request")[0]?.fields.status).toBe(404);
  });

  it("doesn't log a cancelled request", async () => {
    storeAccessToken(FIRST_ACCESS);
    const controller = new AbortController();
    controller.abort();

    await expect(api.GET("/api/auth/me", { signal: controller.signal })).rejects.toThrow();

    expect(logged("api.request_failed")).toEqual([]);
  });
});
