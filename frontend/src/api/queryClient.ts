import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "./errors";

/** Client errors (4xx) won't change on a retry, so only network and server errors are retried. */
function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: shouldRetry, staleTime: 30_000 } },
  });
}
