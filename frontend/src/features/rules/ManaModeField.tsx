import { useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { useFieldError } from "@/catalog/useFieldError";

import type { RulesFormValues } from "./rulesetValues";
import { SETTING_LABELS } from "./settingFields";

type ManaMode = RulesFormValues["mana"]["mode"];

// What each mode does, in the words of backend_plan §7.3. The engine applies it; this only says it.
const MODES: readonly { value: ManaMode; label: string; hint: string }[] = [
  {
    value: "grow",
    label: "Grow and refill",
    hint: "Each turn, a player's maximum mana rises by Mana per turn, up to Maximum mana, and their mana refills.",
  },
  {
    value: "restore",
    label: "Restore a fixed amount",
    hint: "Each turn, a player gets Mana per turn back, up to Maximum mana. Unspent mana carries over.",
  },
];

/** How a player's mana comes back each turn: the maximum grows and refills, or a fixed amount. */
export function ManaModeField() {
  const { register } = useFormContext<RulesFormValues>();
  const mode = useWatch<RulesFormValues, "mana.mode">({ name: "mana.mode" });
  const error = useFieldError("mana.mode");
  const hintId = useId();
  const hint = MODES.find((candidate) => candidate.value === mode)?.hint ?? "";

  return (
    <fieldset aria-describedby={hintId} className="flex flex-col gap-1">
      <legend className="text-sm font-medium">{SETTING_LABELS["mana.mode"]}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {MODES.map((candidate) => (
          <label key={candidate.value} className="flex items-center gap-2">
            <input
              type="radio"
              value={candidate.value}
              className="size-4 accent-accent"
              {...register("mana.mode")}
            />
            {candidate.label}
          </label>
        ))}
      </div>
      <p id={hintId} className="text-sm text-text-muted">
        {hint} A player's first turn has Starting mana. Gain mana in the Turn phases does this.
      </p>
      {error !== undefined && <p className="text-sm text-danger">{error}</p>}
    </fieldset>
  );
}
