import { Navigate, Outlet, useLocation } from "react-router";

import type { FromState } from "./redirect";
import { useAuth } from "./useAuth";

/**
 * Lets only logged-in users through. Others go to /login, which remembers this page, except
 * after an intended logout: then the next login starts from the dashboard.
 */
export function ProtectedRoute() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === "authenticated") return <Outlet />;
  if (state.status === "loading") return null;

  const remember = state.reason !== "logout";
  const from: FromState | null = remember
    ? { from: `${location.pathname}${location.search}${location.hash}` }
    : null;
  return <Navigate to="/login" replace state={from} />;
}
