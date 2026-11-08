import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { AuthProvider } from "@/auth/AuthProvider";
import { SESSION_HINT_KEY } from "@/auth/tokens";
import { routes } from "@/routes";

/**
 * Leaves the hint a login leaves, so the next `renderApp` starts by restoring the session from
 * the refresh cookie. The fake refresh succeeds unless the test overrides it.
 */
export function saveSession(): void {
  localStorage.setItem(SESSION_HINT_KEY, "1");
}

/** Renders the whole app (its real routes) at `path`, with a fresh query cache. */
export function renderApp(path = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, router, queryClient, user };
}
