import { QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { createQueryClient } from "@/api/queryClient";
import { AuthProvider } from "@/auth/AuthProvider";
import { onRouterError } from "@/log/errorHandlers";
import { logPageViews } from "@/log/pageViews";
import { routes } from "@/routes";

const queryClient = createQueryClient();
const router = createBrowserRouter(routes);
// Page views are breadcrumbs: an error sent to the server shows the pages before it.
logPageViews(router);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} onError={onRouterError} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
