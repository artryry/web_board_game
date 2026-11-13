import { createContext, use } from "react";

/**
 * Errors about form fields that come from outside the form's own checks, keyed by the field's
 * path (`turn.2.params.time_limit_s`). The rules editor fills it from the server's `/validate`
 * answer. They aren't put into React Hook Form with `setError`, which would stop Save until each
 * one was cleared: the server decides, and its answer follows the values on its own.
 */
export const OutsideFieldErrors = createContext<ReadonlyMap<string, string>>(new Map());

export function useOutsideFieldError(path: string): string | undefined {
  return use(OutsideFieldErrors).get(path);
}
