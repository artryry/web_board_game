import { useWatch, type Control } from "react-hook-form";

import type { RulesetDefinition } from "@/api/hooks/useRulesets";

import type { RulesFormValues } from "./rulesetValues";

const DEFINITION_FIELDS = [
  "schema_version",
  "board",
  "deck",
  "mana",
  "hand",
  "setup",
  "turn",
] as const;

/** The definition as the form holds it now, without the name. */
export function useWatchedDefinition(control: Control<RulesFormValues>): RulesetDefinition {
  const [schema_version, board, deck, mana, hand, setup, turn] = useWatch({
    control,
    name: DEFINITION_FIELDS,
  });
  return { schema_version, board, deck, mana, hand, setup, turn };
}
