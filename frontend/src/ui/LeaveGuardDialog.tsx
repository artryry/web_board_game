import type { Blocker } from "react-router";

import { ConfirmDialog } from "@/ui/ConfirmDialog";

interface LeaveGuardDialogProps {
  blocker: Blocker;
  /** What would be lost, for example "Your changes to this deck will be lost." */
  message: string;
  /** The question; an editor's is about unsaved changes. */
  title?: string;
}

/** The question a blocked navigation asks: leave and lose something, or stay. */
export function LeaveGuardDialog({
  blocker,
  message,
  title = "Leave without saving?",
}: LeaveGuardDialogProps) {
  return (
    <ConfirmDialog
      open={blocker.state === "blocked"}
      title={title}
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
