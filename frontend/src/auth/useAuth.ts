import { use } from "react";

import { AuthContext, type AuthContextValue, type User } from "./AuthContext";

export function useAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (value === null) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/** The logged-in user, for pages behind `ProtectedRoute`. */
export function useCurrentUser(): User {
  const { state } = useAuth();
  if (state.status !== "authenticated") {
    throw new Error("useCurrentUser must be used on a page behind <ProtectedRoute>");
  }
  return state.user;
}
