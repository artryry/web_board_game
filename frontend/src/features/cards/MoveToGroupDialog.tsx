import { useState } from "react";

import { errorMessage } from "@/api/errors";
import { useUpdateCard, type Card } from "@/api/hooks/useCards";
import type { CardGroup } from "@/api/hooks/useCardGroups";
import { Button } from "@/ui/Button";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { Modal } from "@/ui/Modal";

interface MoveToGroupDialogProps {
  /** The card to move; null keeps the dialog closed. */
  card: Card | null;
  groups: readonly CardGroup[];
  onClose: () => void;
}

/** Moves a card into a group, or out of every group. */
export function MoveToGroupDialog({ card, groups, onClose }: MoveToGroupDialogProps) {
  return (
    <Modal open={card !== null} title={`Move ${card?.name ?? "card"}`} onClose={onClose} size="sm">
      {card !== null && <MoveForm card={card} groups={groups} onDone={onClose} />}
    </Modal>
  );
}

function MoveForm({
  card,
  groups,
  onDone,
}: {
  card: Card;
  groups: readonly CardGroup[];
  onDone: () => void;
}) {
  const update = useUpdateCard();
  const [groupId, setGroupId] = useState(card.group_id ?? "");
  const choices = [{ id: "", name: "No group" }, ...groups];

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        // Only the group is sent: the server keeps the rest of the card as it is.
        update.mutate(
          { id: card.id, body: { group_id: groupId === "" ? null : groupId } },
          { onSuccess: onDone },
        );
      }}
    >
      <fieldset>
        <legend className="text-sm font-medium">Group</legend>
        <div className="mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto">
          {choices.map((choice) => (
            <label key={choice.id} className="flex items-center gap-2 py-1">
              <input
                type="radio"
                name="group"
                value={choice.id}
                checked={groupId === choice.id}
                onChange={() => {
                  setGroupId(choice.id);
                }}
                className="accent-accent"
              />
              {choice.name}
            </label>
          ))}
        </div>
      </fieldset>
      {update.error !== null && <ErrorAlert>{errorMessage(update.error)}</ErrorAlert>}
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" busy={update.isPending}>
          Move
        </Button>
      </div>
    </form>
  );
}
