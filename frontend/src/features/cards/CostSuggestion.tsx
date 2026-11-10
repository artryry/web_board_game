import { useFormContext, useWatch } from "react-hook-form";

import { MANA_MAX } from "@/api/bounds";
import type { Catalog } from "@/catalog/useCatalog";
import { Button } from "@/ui/Button";

import { cardContent, suggestedCost, type CardFormValues } from "./cardValues";

/**
 * The suggested mana cost, worked out locally as the stats and ability settings change. It is
 * advice only: the mana field stays the user's choice and Save never waits on it.
 */
export function CostSuggestion({ catalog }: { catalog: Catalog }) {
  const { control, setValue } = useFormContext<CardFormValues>();
  const [kind, hp, dmg, abilities] = useWatch<CardFormValues, ["kind", "hp", "dmg", "abilities"]>({
    control,
    name: ["kind", "hp", "dmg", "abilities"],
  });
  const suggested = suggestedCost(cardContent({ kind, hp, dmg, abilities }, catalog), catalog);
  const tooStrong = suggested > MANA_MAX;

  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-border bg-surface p-3">
      <p aria-live="polite">
        Suggested cost: <span className="font-semibold">{suggested}</span>
      </p>
      {tooStrong && (
        <p className="text-sm text-text-muted">
          This card is stronger than any legal cost. The highest cost is {MANA_MAX}.
        </p>
      )}
      <Button
        variant="secondary"
        onClick={() => {
          setValue("mana_cost", Math.min(suggested, MANA_MAX), {
            shouldDirty: true,
            shouldValidate: true,
          });
        }}
      >
        Use suggested
      </Button>
      <p className="text-xs text-text-muted">Advice only: the cost is your choice.</p>
    </div>
  );
}
