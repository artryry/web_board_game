import { Navigate, Outlet, useLocation } from "react-router";

import { readFrom } from "./redirect";
import { useAuth } from "./useAuth";

/**
 * For /login and /register. A logged-in user goes to the page they came from (default /), which
 * is also how a successful login or registration leaves these pages.
 */
export function GuestRoute() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === "authenticated") {
    return <Navigate to={readFrom(location.state) ?? "/"} replace />;
  }
  return <Outlet />;
}
