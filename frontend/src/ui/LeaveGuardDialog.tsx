import type { Blocker } from "react-router";

import { ConfirmDialog } from "@/ui/ConfirmDialog";

interface LeaveGuardDialogProps {
  blocker: Blocker;
  /** What would be lost, for example "Your changes to this deck will be lost." */
  message: string;
}

/** The question a blocked navigation asks: leave and lose the changes, or stay. */
export function LeaveGuardDialog({ blocker, message }: LeaveGuardDialogProps) {
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
      <p>{message}</p>
    </ConfirmDialog>
  );
}
