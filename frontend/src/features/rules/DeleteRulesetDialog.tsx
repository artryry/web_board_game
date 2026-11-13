import { errorMessage } from "@/api/errors";
import { useDeleteRuleset, type Ruleset } from "@/api/hooks/useRulesets";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { ErrorAlert } from "@/ui/ErrorAlert";

interface DeleteRulesetDialogProps {
  /** The rule set to delete; null keeps the dialog closed. */
  ruleset: Pick<Ruleset, "id" | "name" | "share_code"> | null;
  onClose: () => void;
  onDeleted: () => void;
}

/** Asks before deleting a rule set. A shared one's link stops working, so the dialog says so. */
export function DeleteRulesetDialog({ ruleset, onClose, onDeleted }: DeleteRulesetDialogProps) {
  const remove = useDeleteRuleset();

  function close() {
    remove.reset();
    onClose();
  }

  return (
    <ConfirmDialog
      open={ruleset !== null}
      title={`Delete ${ruleset?.name ?? ""}?`}
      confirmLabel="Delete"
      busy={remove.isPending}
      onConfirm={() => {
        if (ruleset === null) return;
        remove.mutate(ruleset.id, {
          onSuccess: () => {
            remove.reset();
            onDeleted();
          },
        });
      }}
      onClose={close}
    >
      <p>This can't be undone.</p>
      {ruleset?.share_code != null && <p>Its share link stops working.</p>}
      {remove.error !== null && <ErrorAlert>{errorMessage(remove.error)}</ErrorAlert>}
    </ConfirmDialog>
  );
}
