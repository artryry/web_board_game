import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";
import { unwrap } from "@/api/errors";
import type { components } from "@/api/schema";

import { fetchAllPages } from "./fetchAllPages";

export type Ruleset = components["schemas"]["RulesetOut"];
export type DeckRules = components["schemas"]["DeckRules"];

/** The seeded, read-only system ruleset (backend `DEFAULT_RULESET_KEY`). */
export const DEFAULT_RULESET_KEY = "default";

/** Every ruleset the user can use: the default first, then their own, by name. */
export function useRulesets() {
  return useQuery({
    queryKey: ["rulesets", "list"],
    queryFn: ({ signal }) =>
      fetchAllPages(async (offset, limit) =>
        unwrap(await api.GET("/api/rulesets", { params: { query: { offset, limit } }, signal })),
      ),
  });
}

export function findDefaultRuleset(rulesets: readonly Ruleset[]): Ruleset | undefined {
  return rulesets.find((ruleset) => ruleset.system_key === DEFAULT_RULESET_KEY);
}
