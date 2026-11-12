import { errorMessage } from "@/api/errors";
import { useDeleteDeck, type DeckSummary } from "@/api/hooks/useDecks";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { ErrorAlert } from "@/ui/ErrorAlert";

interface DeleteDeckDialogProps {
  /** The deck to delete; null keeps the dialog closed. */
  deck: Pick<DeckSummary, "id" | "name" | "share_code"> | null;
  onClose: () => void;
  onDeleted: () => void;
}

/** Asks before deleting a deck. A shared deck's link stops working, so the dialog says so. */
export function DeleteDeckDialog({ deck, onClose, onDeleted }: DeleteDeckDialogProps) {
  const remove = useDeleteDeck();

  function close() {
    remove.reset();
    onClose();
  }

  return (
    <ConfirmDialog
      open={deck !== null}
      title={`Delete ${deck?.name ?? ""}?`}
      confirmLabel="Delete"
      busy={remove.isPending}
      onConfirm={() => {
        if (deck === null) return;
        remove.mutate(deck.id, {
          onSuccess: () => {
            remove.reset();
            onDeleted();
          },
        });
      }}
      onClose={close}
    >
      <p>This can't be undone. Its cards stay in your library.</p>
      {deck?.share_code != null && <p>Its share link stops working.</p>}
      {remove.error !== null && <ErrorAlert>{errorMessage(remove.error)}</ErrorAlert>}
    </ConfirmDialog>
  );
}
