import { createContext, use } from "react";

import { NO_RULE_ERRORS, type PlacedRuleErrors } from "./ruleErrors";

/** The server's latest rule errors for the open rule set, sorted by where they show. */
export const RuleErrorsContext = createContext<PlacedRuleErrors>(NO_RULE_ERRORS);

export function usePlacedRuleErrors(): PlacedRuleErrors {
  return use(RuleErrorsContext);
}
