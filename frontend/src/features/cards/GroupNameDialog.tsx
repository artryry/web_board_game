import { useForm } from "react-hook-form";

import { NAME_MAX_LENGTH } from "@/api/bounds";
import { useCreateCardGroup, useRenameCardGroup, type CardGroup } from "@/api/hooks/useCardGroups";
import { showServerError } from "@/api/showServerError";
import { Button } from "@/ui/Button";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { Modal } from "@/ui/Modal";
import { TextField } from "@/ui/TextField";

/** What the dialog does: make a group, or rename one. */
export type GroupNameTarget = { mode: "create" } | { mode: "rename"; group: CardGroup };

interface GroupNameDialogProps {
  target: GroupNameTarget | null;
  onClose: () => void;
}

/** Names a new card group, or renames one. A name the user already has shows on the field. */
export function GroupNameDialog({ target, onClose }: GroupNameDialogProps) {
  const title = target?.mode === "rename" ? `Rename ${target.group.name}` : "New group";
  return (
    <Modal open={target !== null} title={title} onClose={onClose} size="sm">
      {target !== null && <GroupNameForm target={target} onDone={onClose} />}
    </Modal>
  );
}

function GroupNameForm({ target, onDone }: { target: GroupNameTarget; onDone: () => void }) {
  const create = useCreateCardGroup();
  const rename = useRenameCardGroup();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<{ name: string }>({
    defaultValues: { name: target.mode === "rename" ? target.group.name : "" },
  });

  const submit = handleSubmit(async ({ name }) => {
    try {
      const trimmed = name.trim();
      if (target.mode === "create") await create.mutateAsync(trimmed);
      else await rename.mutateAsync({ id: target.group.id, name: trimmed });
      onDone();
    } catch (error) {
      showServerError(error, setError, ["name"], { group_name_taken: "name" });
    }
  });

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {errors.root?.server && <ErrorAlert>{errors.root.server.message}</ErrorAlert>}
      <TextField
        label="Name"
        autoComplete="off"
        data-autofocus
        error={errors.name?.message}
        {...register("name", {
          validate: (name) => name.trim() !== "" || "Give the group a name.",
          maxLength: {
            value: NAME_MAX_LENGTH,
            message: `Use at most ${NAME_MAX_LENGTH} characters.`,
          },
        })}
      />
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" busy={isSubmitting}>
          {target.mode === "create" ? "Create group" : "Rename"}
        </Button>
      </div>
    </form>
  );
}
