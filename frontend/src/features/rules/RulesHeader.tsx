import { useFormContext } from "react-hook-form";

import { NAME_MAX_LENGTH } from "@/api/bounds";
import { Button } from "@/ui/Button";
import { ButtonLink } from "@/ui/ButtonLink";
import { TextField } from "@/ui/TextField";

import type { RulesFormValues } from "./rulesetValues";

interface RulesHeaderProps {
  /** The id of the user's own saved rule set: Duplicate, Share and Delete need one. */
  savedId: string | undefined;
  readOnly: boolean;
  saving: boolean;
  onShare: () => void;
  onDelete: () => void;
}

/** The rule set's name and its actions. It sits inside the editor's form. */
export function RulesHeader({ savedId, readOnly, saving, onShare, onDelete }: RulesHeaderProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<RulesFormValues>();

  return (
    <div className="flex flex-wrap items-start gap-4">
      <TextField
        label="Name"
        autoComplete="off"
        disabled={readOnly}
        error={errors.name?.message}
        {...register("name", {
          validate: (name) => name.trim() !== "" || "Give the rule set a name.",
          maxLength: {
            value: NAME_MAX_LENGTH,
            message: `Use at most ${NAME_MAX_LENGTH} characters.`,
          },
        })}
      />
      {!readOnly && (
        <div className="ml-auto flex flex-wrap gap-3 sm:mt-6">
          {savedId !== undefined && (
            <>
              <ButtonLink variant="secondary" to={`/rules/new?from=${savedId}`}>
                Duplicate
              </ButtonLink>
              <Button variant="secondary" onClick={onShare}>
                Share
              </Button>
              <Button variant="danger" onClick={onDelete}>
                Delete
              </Button>
            </>
          )}
          <Button type="submit" busy={saving}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
