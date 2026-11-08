import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { apiError, apiUrl, REFRESHED_ACCESS, TEST_USER } from "@/test/handlers";
import { renderApp, saveSession } from "@/test/renderApp";
import { server } from "@/test/server";

import { getAccessToken, hasSavedSession, SESSION_HINT_KEY } from "./tokens";

async function findDashboard() {
  return screen.findByRole("heading", { name: `Welcome, ${TEST_USER.username}` });
}

describe("session", () => {
  it("restores a saved session on start", async () => {
    saveSession();
    renderApp("/");

    expect(screen.getByRole("status")).toHaveTextContent("Loading your session");
    expect(await findDashboard()).toBeInTheDocument();
    expect(getAccessToken()).toBe(REFRESHED_ACCESS);
  });

  it("doesn't call the server on start when there is no saved session", async () => {
    let refreshes = 0;
    server.use(
      http.post(apiUrl("/api/auth/refresh"), () => {
        refreshes += 1;
        return apiError(401, "not_authenticated");
      }),
    );
    renderApp("/");

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(refreshes).toBe(0);
  });

  it("sends the user to /login, remembering the page, when the saved session is gone", async () => {
    saveSession();
    server.use(http.post(apiUrl("/api/auth/refresh"), () => apiError(401, "token_expired")));
    const view = renderApp("/decks");

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(view.router.state.location.state).toEqual({ from: "/decks" });
    expect(hasSavedSession()).toBe(false);
  });

  it("logs out: deletes the cookie, clears the cache and opens /login fresh", async () => {
    let logouts = 0;
    server.use(
      http.post(apiUrl("/api/auth/logout"), () => {
        logouts += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    saveSession();
    const view = renderApp("/");
    await findDashboard();
    expect(view.queryClient.getQueryCache().getAll()).not.toHaveLength(0);

    await view.user.click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(view.router.state.location.state).toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(hasSavedSession()).toBe(false);
    expect(view.queryClient.getQueryCache().getAll()).toHaveLength(0);
    await waitFor(() => {
      expect(logouts).toBe(1);
    });
  });

  it("logs out when another tab logs out", async () => {
    saveSession();
    const view = renderApp("/");
    await findDashboard();

    act(() => {
      // What the browser does here when another tab removes the hint.
      localStorage.removeItem(SESSION_HINT_KEY);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: SESSION_HINT_KEY,
          oldValue: "1",
          newValue: null,
          storageArea: localStorage,
        }),
      );
    });

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(view.router.state.location.state).toBeNull();
    expect(getAccessToken()).toBeNull();
  });
});
