import { useWatch } from "react-hook-form";

import { MAX_ABILITIES } from "@/api/bounds";
import { ModuleListField } from "@/catalog/ModuleListField";
import type { Catalog } from "@/catalog/useCatalog";

import type { CardFormValues } from "./cardValues";
import { SpellEffectField } from "./SpellEffectField";

/** A creature's abilities (at most 2, no repeats), or a spell's one effect. */
export function AbilitiesField({ catalog }: { catalog: Catalog }) {
  const kind = useWatch<CardFormValues, "kind">({ name: "kind" });
  if (kind === "spell") return <SpellEffectField spells={catalog.spells} />;
  return (
    <ModuleListField
      name="abilities"
      label="Abilities"
      noun="ability"
      modules={catalog.features}
      max={MAX_ABILITIES}
    />
  );
}
