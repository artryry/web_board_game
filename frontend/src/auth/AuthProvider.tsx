import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { api, clearRefreshCookie, refreshSession } from "@/api/client";
import { unwrap } from "@/api/errors";
import type { components } from "@/api/schema";
import { log } from "@/log/logger";
import { Spinner } from "@/ui/Spinner";

import {
  AuthContext,
  type AuthContextValue,
  type AuthState,
  type LoginValues,
  type RegisterValues,
  type User,
} from "./AuthContext";
import {
  endSession,
  hasSavedSession,
  listenToOtherTabs,
  onSessionEnd,
  storeAccessToken,
} from "./tokens";

type AccessToken = components["schemas"]["AccessToken"];

async function fetchMe(): Promise<User> {
  return unwrap(await api.GET("/api/auth/me"));
}

/** Renews the saved session. Resolves null when it can't be renewed (the session has ended). */
async function restoreSession(): Promise<User | null> {
  return (await refreshSession()) ? fetchMe() : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>(() =>
    hasSavedSession() ? { status: "loading" } : { status: "anonymous", reason: "none" },
  );

  // Every way a session ends (logout here or in another tab, a failed refresh) lands here.
  useEffect(() => {
    const stopListening = onSessionEnd((reason) => {
      queryClient.clear();
      setState({ status: "anonymous", reason });
    });
    const stopOtherTabs = listenToOtherTabs();
    return () => {
      stopListening();
      stopOtherTabs();
    };
  }, [queryClient]);

  useEffect(() => {
    if (!hasSavedSession()) return;
    let active = true;
    restoreSession()
      .then((user) => {
        if (active && user !== null) setState({ status: "authenticated", user });
      })
      .catch((error: unknown) => {
        // The server couldn't be reached: show the login page. The cookie and the hint are
        // kept, so a reload can still restore the session.
        log.warn("auth.restore_failed", {}, error);
        if (active) setState({ status: "anonymous", reason: "expired" });
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    // The answer has already set the refresh cookie; the body carries the access token.
    async function startSession(token: AccessToken): Promise<void> {
      storeAccessToken(token.access);
      setState({ status: "authenticated", user: await fetchMe() });
    }
    return {
      state,
      login: async (values: LoginValues) => {
        await startSession(unwrap(await api.POST("/api/auth/login", { body: values })));
      },
      register: async (values: RegisterValues) => {
        await startSession(unwrap(await api.POST("/api/auth/register", { body: values })));
      },
      logout: () => {
        // End the session here first, so the page switches at once, then delete the cookie.
        endSession("logout");
        void clearRefreshCookie();
      },
    };
  }, [state]);

  if (state.status === "loading") {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner size="lg" label="Loading your session" />
      </div>
    );
  }
  return <AuthContext value={value}>{children}</AuthContext>;
}
