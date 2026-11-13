import { useWatch } from "react-hook-form";

import { findModule, type Catalog } from "@/catalog/useCatalog";

import type { RulesFormValues } from "./rulesetValues";

/** The turn's phases in order, read-only, as the in-game phase tracker will show them. */
export function TurnOrderStrip({ catalog }: { catalog: Catalog }) {
  const turn = useWatch<RulesFormValues, "turn">({ name: "turn" });

  return (
    <section aria-labelledby="turn-order-title" className="flex flex-col gap-1">
      <h3 id="turn-order-title" className="font-semibold">
        Turn order
      </h3>
      <ol aria-labelledby="turn-order-title" className="flex flex-wrap items-center gap-1 text-sm">
        {turn.map((phase, index) => (
          // The position is the identity here: the same phase may appear twice.
          <li key={index} className="flex items-center gap-1">
            {index > 0 && (
              <span aria-hidden="true" className="text-text-muted">
                →
              </span>
            )}
            <span className="rounded-md bg-surface-raised px-2 py-0.5">
              {findModule(catalog.phases, phase.key)?.name ?? phase.key}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
