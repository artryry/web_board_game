import { useEffect, useState } from "react";

/**
 * The value as it was once it stopped changing for `delayMs`. It starts at the first value, so the
 * first render doesn't wait.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return settled;
}
