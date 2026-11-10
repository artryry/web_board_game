import { errorMessage } from "@/api/errors";
import { useDeleteCardGroup, type CardGroup } from "@/api/hooks/useCardGroups";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { ErrorAlert } from "@/ui/ErrorAlert";

interface DeleteGroupDialogProps {
  /** The group to delete; null keeps the dialog closed. */
  group: CardGroup | null;
  onClose: () => void;
  onDeleted: (group: CardGroup) => void;
}

/** Asks before deleting a group. Its cards stay in the library, ungrouped. */
export function DeleteGroupDialog({ group, onClose, onDeleted }: DeleteGroupDialogProps) {
  const remove = useDeleteCardGroup();

  function close() {
    remove.reset();
    onClose();
  }

  return (
    <ConfirmDialog
      open={group !== null}
      title={`Delete ${group?.name ?? "group"}?`}
      confirmLabel="Delete group"
      busy={remove.isPending}
      onConfirm={() => {
        if (group === null) return;
        remove.mutate(group.id, {
          onSuccess: () => {
            onDeleted(group);
            close();
          },
        });
      }}
      onClose={close}
    >
      <p>
        {group?.card_count === 1
          ? "Its card stays in your library, without a group."
          : `Its ${group?.card_count ?? 0} cards stay in your library, without a group.`}
      </p>
      {remove.error !== null && <ErrorAlert>{errorMessage(remove.error)}</ErrorAlert>}
    </ConfirmDialog>
  );
}
