import { useFormContext, useWatch } from "react-hook-form";

import {
  CREATURE_DMG_MAX,
  CREATURE_DMG_MIN,
  HP_MAX,
  HP_MIN,
  SPELL_AMOUNT_MAX,
  SPELL_AMOUNT_MIN,
} from "@/api/bounds";
import type { Catalog } from "@/catalog/useCatalog";
import { TextField } from "@/ui/TextField";

import { spellDmgUse, type CardFormValues } from "./cardValues";
import { wholeNumber } from "./wholeNumber";

interface DmgInput {
  label: string;
  min: number;
  max: number;
}

/**
 * HP and DMG for the card's kind. A spell has no HP, and its DMG field follows the chosen
 * effect: "Damage", "Heal" (typed as the amount, sent as a negative number), or none at all.
 */
export function StatFields({ catalog }: { catalog: Catalog }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<CardFormValues>();
  const [kind, abilities] = useWatch<CardFormValues, ["kind", "abilities"]>({
    name: ["kind", "abilities"],
  });
  const dmg = dmgInput(
    kind === "creature" ? "creature" : spellDmgUse({ kind, abilities }, catalog),
  );

  if (kind === "spell" && dmg === null) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {kind === "creature" && (
        <TextField
          label="HP"
          type="number"
          inputMode="numeric"
          min={HP_MIN}
          max={HP_MAX}
          error={errors.hp?.message}
          {...register("hp", wholeNumber("HP", HP_MIN, HP_MAX))}
        />
      )}
      {dmg !== null && (
        <TextField
          label={dmg.label}
          type="number"
          inputMode="numeric"
          min={dmg.min}
          max={dmg.max}
          error={errors.dmg?.message}
          {...register("dmg", wholeNumber(dmg.label, dmg.min, dmg.max))}
        />
      )}
    </div>
  );
}

function dmgInput(use: "creature" | "damage" | "heal" | "none" | null): DmgInput | null {
  switch (use) {
    case "creature":
      return { label: "DMG", min: CREATURE_DMG_MIN, max: CREATURE_DMG_MAX };
    case "damage":
      return { label: "Damage", min: SPELL_AMOUNT_MIN, max: SPELL_AMOUNT_MAX };
    case "heal":
      return { label: "Heal", min: SPELL_AMOUNT_MIN, max: SPELL_AMOUNT_MAX };
    default:
      // `none` (for example draw_cards), or a spell whose effect isn't chosen yet.
      return null;
  }
}
