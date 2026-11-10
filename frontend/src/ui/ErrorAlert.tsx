import type { ReactNode } from "react";

/** A failed action's message, announced to screen readers. It may hold a list below the text. */
export function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
      {children}
    </div>
  );
}
