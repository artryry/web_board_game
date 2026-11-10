import type { ReactNode } from "react";

import type { Origin } from "@/api/hooks/useOrigins";
import { findModule, type Catalog } from "@/catalog/useCatalog";

import { OriginBadge } from "./OriginBadge";
import { originHex } from "./originLook";

interface OriginListItemProps {
  origin: Origin;
  catalog: Catalog;
  /** The links and buttons for this origin. */
  actions: ReactNode;
}

export function OriginListItem({ origin, catalog, actions }: OriginListItemProps) {
  const hex = originHex(catalog, origin.color);
  const effects = origin.field_effects.map(
    (effect) => findModule(catalog.field_effects, effect.key)?.name ?? effect.key,
  );

  return (
    <li className="flex flex-col gap-3 overflow-hidden rounded-lg border border-border bg-surface">
      <div aria-hidden="true" className="h-1.5" style={{ backgroundColor: hex }} />
      <div className="flex flex-col gap-1 px-4">
        <h3 className="font-medium">
          <OriginBadge name={origin.name} icon={origin.icon} hex={hex} />
        </h3>
        <p className="text-sm text-text-muted">
          {effects.length === 0 ? "No field effects" : effects.join(", ")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 px-4 pb-4">{actions}</div>
    </li>
  );
}
