import { useFieldArray, useFormContext } from "react-hook-form";

import type { Catalog } from "@/catalog/useCatalog";

import { ModulePalette, type PhaseSpec } from "./ModulePalette";
import { PhasePipeline } from "./PhasePipeline";
import { newPhase, phaseInsertIndex, type Pipeline } from "./phaseList";
import type { RulesFormValues } from "./rulesetValues";
import { TurnOrderStrip } from "./TurnOrderStrip";

/** The Setup and Turn pipelines, the turn order, and the palette that adds phases to either. */
export function RulesPhases({ catalog, readOnly }: { catalog: Catalog; readOnly: boolean }) {
  const { control, getValues } = useFormContext<RulesFormValues>();
  const setup = useFieldArray({ control, name: "setup" });
  const turn = useFieldArray({ control, name: "turn" });

  function add(pipeline: Pipeline, spec: PhaseSpec) {
    const phases = pipeline === "setup" ? setup : turn;
    // Focus stays on the palette, so several phases can be added in a row.
    phases.insert(phaseInsertIndex(getValues(pipeline), pipeline), newPhase(spec), {
      shouldFocus: false,
    });
  }

  return (
    <section aria-labelledby="rules-phases-title" className="flex flex-col gap-6">
      <h2 id="rules-phases-title" className="text-lg font-semibold">
        Phases
      </h2>
      <PhasePipeline
        pipeline="setup"
        title="Setup"
        hint="Runs once, before the first turn."
        phases={setup}
        catalog={catalog}
        readOnly={readOnly}
      />
      <PhasePipeline
        pipeline="turn"
        title="Turn"
        hint="Runs every turn, in this order."
        phases={turn}
        catalog={catalog}
        readOnly={readOnly}
      />
      <TurnOrderStrip catalog={catalog} />
      {!readOnly && <ModulePalette phases={catalog.phases} onAdd={add} />}
    </section>
  );
}
