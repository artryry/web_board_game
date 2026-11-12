import { ConfirmDialog } from "@/ui/ConfirmDialog";

import { deckSize, type DeckEntry } from "./deckEntries";

interface OriginChangeDialogProps {
  /** The new origin's name; null keeps the dialog closed. */
  originName: string | null;
  /** The cards that don't fit the new origin. */
  dropped: readonly DeckEntry[];
  onConfirm: () => void;
  onClose: () => void;
}

/** Asks before an origin change removes the cards that are neither of the new origin nor neutral. */
export function OriginChangeDialog({
  originName,
  dropped,
  onConfirm,
  onClose,
}: OriginChangeDialogProps) {
  const count = deckSize(dropped);
  return (
    <ConfirmDialog
      open={originName !== null}
      title={`Change the origin to ${originName ?? ""}?`}
      confirmLabel="Change origin"
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>
        {count === 1 ? "This card" : `These ${count} cards`} will be removed, since{" "}
        {count === 1 ? "it isn't" : "they aren't"} of the new origin or neutral:
      </p>
      <ul className="list-disc pl-5 text-sm">
        {dropped.map((entry) => (
          <li key={entry.card.id}>
            {entry.card.name}
            {entry.count > 1 && ` ×${entry.count}`}
          </li>
        ))}
      </ul>
    </ConfirmDialog>
  );
}
