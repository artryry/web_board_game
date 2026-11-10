import { useFormContext } from "react-hook-form";

import type { CardFormValues } from "./cardValues";

const KINDS = [
  { value: "creature", label: "Creature" },
  { value: "spell", label: "Spell" },
] as const;

const OPTION =
  "flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 has-[:checked]:border-accent has-[:checked]:bg-surface-raised";

/**
 * Creature or spell. Changing it clears the abilities: creature features and spell effects are
 * different modules.
 */
export function KindField() {
  const { register, setValue } = useFormContext<CardFormValues>();
  return (
    <fieldset>
      <legend className="text-sm font-medium">Kind</legend>
      <div className="mt-2 flex gap-2">
        {KINDS.map((kind) => (
          <label key={kind.value} className={OPTION}>
            <input
              type="radio"
              value={kind.value}
              className="accent-accent"
              {...register("kind", {
                onChange: () => {
                  setValue("abilities", [], { shouldDirty: true });
                },
              })}
            />
            {kind.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
