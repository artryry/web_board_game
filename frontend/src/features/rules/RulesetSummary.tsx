import { FormProvider, useForm } from "react-hook-form";

import type { RulesetDefinition } from "@/api/hooks/useRulesets";
import type { Catalog } from "@/catalog/useCatalog";

import { toFormValues, type RulesFormValues } from "./rulesetValues";
import { RulesPhases } from "./RulesPhases";
import { RulesSettingsForm } from "./RulesSettingsForm";

/**
 * A rule set to look at, not change: the editor's settings and phases, read-only, over a form of
 * their own. The import page shows a shared rule set with it.
 */
export function RulesetSummary({
  definition,
  catalog,
}: {
  definition: RulesetDefinition;
  catalog: Catalog;
}) {
  const form = useForm<RulesFormValues>({ defaultValues: toFormValues("", definition) });
  return (
    <FormProvider {...form}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <RulesSettingsForm readOnly />
        <RulesPhases catalog={catalog} readOnly />
      </div>
    </FormProvider>
  );
}
