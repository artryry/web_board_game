import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { useWatch } from "react-hook-form";

import { errorMessage } from "@/api/errors";
import type { RulesetValidation } from "@/api/hooks/useRulesets";
import { findModule, type Catalog } from "@/catalog/useCatalog";

import type { Pipeline } from "./phaseList";
import { errorPlace } from "./ruleErrors";
import type { RulesFormValues } from "./rulesetValues";

interface ValidationStatusProps {
  validation: RulesetValidation | undefined;
  checking: boolean;
  error: Error | null;
  catalog: Catalog;
}

/** The server's verdict on the rules as they are now, and every problem it found. */
export function ValidationStatus({ validation, checking, error, catalog }: ValidationStatusProps) {
  const [setup, turn] = useWatch<RulesFormValues, ["setup", "turn"]>({ name: ["setup", "turn"] });
  const phaseName = (pipeline: Pipeline, index: number) => {
    const key = (pipeline === "setup" ? setup : turn)[index]?.key;
    return key === undefined ? undefined : (findModule(catalog.phases, key)?.name ?? key);
  };

  let status = (
    <>
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Checking…
    </>
  );
  if (!checking && error !== null) {
    status = <>Couldn't check the rules: {errorMessage(error)}</>;
  } else if (!checking && validation?.valid === true) {
    status = (
      <>
        <CircleCheck aria-hidden="true" className="size-4 text-success" /> No problems
      </>
    );
  } else if (!checking && validation !== undefined) {
    const count = validation.errors.length;
    status = (
      <>
        <CircleAlert aria-hidden="true" className="size-4 text-danger" />
        {count === 1 ? "1 problem" : `${count} problems`}
      </>
    );
  }
  const problems = validation?.errors ?? [];

  return (
    <div className="flex flex-col gap-1">
      <p role="status" className="flex items-center gap-2 text-sm">
        {status}
      </p>
      {problems.length > 0 && (
        <ul aria-label="Problems" className="list-disc pl-6 text-sm text-danger">
          {problems.map((problem, index) => {
            const place = errorPlace(problem.path, phaseName);
            return (
              // The server may report the same message twice, at different places.
              <li key={index}>
                {place === null ? problem.message : `${place}: ${problem.message}`}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
