import { useFormContext, useWatch } from "react-hook-form";

import { NAME_MAX_LENGTH } from "@/api/bounds";
import type { Origin } from "@/api/hooks/useOrigins";
import { OriginOptions } from "@/features/cards/OriginOptions";
import { Button } from "@/ui/Button";
import { SelectField } from "@/ui/SelectField";
import { TextField } from "@/ui/TextField";

export interface DeckHeaderValues {
  name: string;
  /** "" until an origin is picked. */
  origin_id: string;
}

interface DeckHeaderProps {
  origins: readonly Origin[];
  /** Share and Delete need a saved deck. */
  saved: boolean;
  saving: boolean;
  /** The builder decides whether the change goes through: it may ask first. */
  onOriginChange: (originId: string) => void;
  onShare: () => void;
  onDelete: () => void;
}

/** The deck's name and origin, and its actions. It sits inside the builder's form. */
export function DeckHeader({
  origins,
  saved,
  saving,
  onOriginChange,
  onShare,
  onDelete,
}: DeckHeaderProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<DeckHeaderValues>();
  const originId = useWatch<DeckHeaderValues, "origin_id">({ name: "origin_id" });

  return (
    <div className="flex flex-wrap items-start gap-4">
      <TextField
        label="Name"
        autoComplete="off"
        error={errors.name?.message}
        {...register("name", {
          validate: (name) => name.trim() !== "" || "Give the deck a name.",
          maxLength: {
            value: NAME_MAX_LENGTH,
            message: `Use at most ${NAME_MAX_LENGTH} characters.`,
          },
        })}
      />
      {/* Registered for its rule and focus; the builder sets the value, since it may ask first. */}
      <SelectField
        label="Origin"
        {...register("origin_id", {
          validate: (value) => value !== "" || "Pick an origin.",
        })}
        value={originId}
        onChange={(event) => {
          onOriginChange(event.target.value);
        }}
        error={errors.origin_id?.message}
      >
        {originId === "" && (
          <option value="" disabled>
            Pick an origin
          </option>
        )}
        <OriginOptions origins={origins} />
      </SelectField>
      <div className="ml-auto flex gap-3 sm:mt-6">
        {saved && (
          <>
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
    </div>
  );
}
