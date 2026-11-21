import { useState } from "react";

export type CopyStatus = "idle" | "copied" | "failed";

/**
 * Copies text to the clipboard. Some browsers refuse it (permissions, an insecure page): then the
 * field that shows the text is selected, so the user can copy it by hand, and `onFailed` gets the
 * error to log.
 */
export function useCopyText(onFailed: (error: unknown) => void) {
  const [status, setStatus] = useState<CopyStatus>("idle");

  async function copy(text: string, field: HTMLInputElement | null): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch (error) {
      onFailed(error);
      field?.select();
      setStatus("failed");
    }
  }

  return { status, copy };
}
