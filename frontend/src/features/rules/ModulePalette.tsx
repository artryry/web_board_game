import type { Catalog } from "@/catalog/useCatalog";
import { Button } from "@/ui/Button";

import type { Pipeline } from "./phaseList";

export type PhaseSpec = Catalog["phases"][number];

interface ModulePaletteProps {
  phases: readonly PhaseSpec[];
  onAdd: (pipeline: Pipeline, spec: PhaseSpec) => void;
}

/**
 * Every phase in the catalog, with buttons that add it to Setup or Turn. It doesn't hide phases
 * that can't go in Setup: the server's check says why. The buttons' labels name the phase (a
 * hidden span in the middle of the text would show as a double space).
 */
export function ModulePalette({ phases, onAdd }: ModulePaletteProps) {
  return (
    <section aria-labelledby="phase-palette-title" className="flex flex-col gap-2">
      <h3 id="phase-palette-title" className="font-semibold">
        Add a phase
      </h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {phases.map((spec) => (
          <li
            key={spec.key}
            className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3"
          >
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {spec.name}
              {spec.interactive && (
                <span className="rounded-md border border-border-strong px-1.5 text-xs font-normal text-text-muted">
                  Interactive
                </span>
              )}
            </p>
            <p className="text-sm text-text-muted">{spec.description}</p>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button
                variant="secondary"
                aria-label={`Add ${spec.name} to Setup`}
                onClick={() => {
                  onAdd("setup", spec);
                }}
              >
                Add to Setup
              </Button>
              <Button
                variant="secondary"
                aria-label={`Add ${spec.name} to Turn`}
                onClick={() => {
                  onAdd("turn", spec);
                }}
              >
                Add to Turn
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
