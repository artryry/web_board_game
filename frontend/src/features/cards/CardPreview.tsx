import { useId } from "react";
import { useWatch } from "react-hook-form";

import type { Origin } from "@/api/hooks/useOrigins";
import type { Catalog } from "@/catalog/useCatalog";

import { CardView } from "./CardView";
import { cardContent, type CardFormValues } from "./cardValues";

interface CardPreviewProps {
  catalog: Catalog;
  origins: readonly Origin[];
  artUrl: string | null;
}

/** The card being edited, as it will look on the board. */
export function CardPreview({ catalog, origins, artUrl }: CardPreviewProps) {
  const [kind, name, manaCost, hp, dmg, abilities, originId] = useWatch<
    CardFormValues,
    ["kind", "name", "mana_cost", "hp", "dmg", "abilities", "origin_id"]
  >({ name: ["kind", "name", "mana_cost", "hp", "dmg", "abilities", "origin_id"] });
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className="text-sm font-medium text-text-muted">
        Preview
      </h2>
      <CardView
        name={name.trim() || "Unnamed card"}
        manaCost={manaCost}
        content={cardContent({ kind, hp, dmg, abilities }, catalog)}
        artUrl={artUrl}
        origin={origins.find((origin) => origin.id === originId)}
        catalog={catalog}
        size="md"
      />
    </section>
  );
}
