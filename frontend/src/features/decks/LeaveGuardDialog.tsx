import type { Blocker } from "react-router";

import { ConfirmDialog } from "@/ui/ConfirmDialog";

/** The question a blocked navigation asks: leave and lose the changes, or stay. */
export function LeaveGuardDialog({ blocker }: { blocker: Blocker }) {
  return (
    <ConfirmDialog
      open={blocker.state === "blocked"}
      title="Leave without saving?"
      confirmLabel="Leave"
      onConfirm={() => {
        blocker.proceed?.();
      }}
      onClose={() => {
        blocker.reset?.();
      }}
    >
      <p>Your changes to this deck will be lost.</p>
    </ConfirmDialog>
  );
}
