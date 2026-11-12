import { errorMessage } from "@/api/errors";
import { useDeleteOrigin, type Origin } from "@/api/hooks/useOrigins";
import { inUseItems } from "@/api/inUse";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { InUseList } from "@/ui/InUseList";

interface DeleteOriginDialogProps {
  /** The origin to delete; null keeps the dialog closed. */
  origin: Origin | null;
  onClose: () => void;
}

/** Asks before deleting an origin, and lists the cards and decks that still use it. */
export function DeleteOriginDialog({ origin, onClose }: DeleteOriginDialogProps) {
  const remove = useDeleteOrigin();

  function close() {
    remove.reset();
    onClose();
  }

  return (
    <ConfirmDialog
      open={origin !== null}
      title={`Delete ${origin?.name ?? "origin"}?`}
      confirmLabel="Delete"
      busy={remove.isPending}
      onConfirm={() => {
        if (origin !== null) remove.mutate(origin.id, { onSuccess: close });
      }}
      onClose={close}
    >
      <p>This can't be undone.</p>
      {remove.error !== null && (
        <ErrorAlert>
          <p>{errorMessage(remove.error)}</p>
          <InUseList
            label="Cards"
            items={inUseItems(remove.error, "cards")}
            linkTo={(id) => `/cards/${id}`}
          />
          <InUseList
            label="Decks"
            items={inUseItems(remove.error, "decks")}
            linkTo={(id) => `/decks/${id}`}
          />
        </ErrorAlert>
      )}
    </ConfirmDialog>
  );
}
