import { errorMessage } from "@/api/errors";
import { useDeleteCard, type Card } from "@/api/hooks/useCards";
import { inUseItems } from "@/api/inUse";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { InUseList } from "@/ui/InUseList";

interface DeleteCardDialogProps {
  card: Card;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

/** Asks before deleting a card, and lists the decks that still hold it. */
export function DeleteCardDialog({ card, open, onClose, onDeleted }: DeleteCardDialogProps) {
  const remove = useDeleteCard();

  function close() {
    remove.reset();
    onClose();
  }

  return (
    <ConfirmDialog
      open={open}
      title={`Delete ${card.name}?`}
      confirmLabel="Delete"
      busy={remove.isPending}
      onConfirm={() => {
        remove.mutate(card.id, { onSuccess: onDeleted });
      }}
      onClose={close}
    >
      <p>This can't be undone.</p>
      {remove.error !== null && (
        <ErrorAlert>
          <p>{errorMessage(remove.error)}</p>
          {/* Decks get their pages in F2, so they show as names for now. */}
          <InUseList label="Decks" items={inUseItems(remove.error, "decks")} />
        </ErrorAlert>
      )}
    </ConfirmDialog>
  );
}
