import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { unwrap } from "@/api/errors";
import type { components } from "@/api/schema";
import { useDebouncedValue } from "@/ui/useDebouncedValue";

import { fetchAllPages } from "./fetchAllPages";

export type Ruleset = components["schemas"]["RulesetOut"];
export type RulesetDefinition = components["schemas"]["RulesetDefinition"];
export type RulesetBody = components["schemas"]["RulesetCreate"];
export type DeckRules = components["schemas"]["DeckRules"];
export type RuleError = components["schemas"]["RuleError"];
export type RulesetValidation = components["schemas"]["RulesetValidation"];

/** The seeded, read-only system ruleset (backend `DEFAULT_RULESET_KEY`). */
export const DEFAULT_RULESET_KEY = "default";

/** How long the editor waits after a change before it asks the server to check the rules. */
export const VALIDATE_DELAY_MS = 500;

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

export function rulesetQueryKey(id: string | undefined) {
  return ["rulesets", "detail", id] as const;
}

/** One ruleset (the user's own or the default), or nothing while `id` is undefined. */
export function useRuleset(id: string | undefined) {
  return useQuery({
    queryKey: rulesetQueryKey(id),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/rulesets/{ruleset_id}", {
          params: { path: { ruleset_id: id ?? "" } },
          signal,
        }),
      ),
    enabled: id !== undefined,
  });
}

/**
 * Ruleset changes refresh every ruleset query: the rules list, the deck builder's validity panel
 * and open rulesets. A saved ruleset's own query gets the server's answer straight away, so the
 * editor doesn't load it again; a deleted one's query is left alone, since it would only answer 404.
 */
function useRefreshRulesets() {
  const queryClient = useQueryClient();
  return {
    saved: (ruleset: Ruleset) => {
      queryClient.setQueryData(rulesetQueryKey(ruleset.id), ruleset);
      return queryClient.invalidateQueries({
        queryKey: ["rulesets"],
        predicate: (query) => query.queryKey[2] !== ruleset.id,
      });
    },
    deleted: (id: string) =>
      queryClient.invalidateQueries({
        queryKey: ["rulesets"],
        predicate: (query) => query.queryKey[2] !== id,
      }),
  };
}

export function useCreateRuleset() {
  const refresh = useRefreshRulesets();
  return useMutation({
    mutationFn: async (body: RulesetBody) => unwrap(await api.POST("/api/rulesets", { body })),
    onSuccess: (ruleset) => refresh.saved(ruleset),
  });
}

/** Saves the editor: `definition` is always the whole one, since the server replaces it. */
export function useUpdateRuleset() {
  const refresh = useRefreshRulesets();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: RulesetBody }) =>
      unwrap(
        await api.PATCH("/api/rulesets/{ruleset_id}", {
          params: { path: { ruleset_id: id } },
          body,
        }),
      ),
    onSuccess: (ruleset) => refresh.saved(ruleset),
  });
}

export function useDeleteRuleset() {
  const refresh = useRefreshRulesets();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(
        await api.DELETE("/api/rulesets/{ruleset_id}", { params: { path: { ruleset_id: id } } }),
      );
    },
    onSuccess: (_data, id) => refresh.deleted(id),
  });
}

/**
 * The server's check of a definition, keyed by its JSON. It sits outside `["rulesets"]`, so saving
 * a ruleset doesn't check the open one again.
 */
export function validationQueryKey(definitionJson: string) {
  return ["ruleset-validation", definitionJson] as const;
}

/**
 * Checks the definition with `POST /api/rulesets/validate` once it has stopped changing for
 * `VALIDATE_DELAY_MS`. Each definition is its own query, so a newer one cancels the older request
 * (the request uses the query's signal), and going back to an earlier one reuses its answer. The
 * last answer stays while the next one loads.
 */
export function useRulesetValidation(definition: RulesetDefinition, enabled: boolean) {
  // A string, so the delay restarts only when the definition really changes.
  const json = JSON.stringify(definition);
  const settled = useDebouncedValue(json, VALIDATE_DELAY_MS);
  const query = useQuery({
    queryKey: validationQueryKey(settled),
    queryFn: async ({ signal }) => {
      const body = { definition: JSON.parse(settled) as Record<string, unknown> };
      return unwrap(await api.POST("/api/rulesets/validate", { body, signal }));
    },
    enabled,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
  return {
    validation: query.data,
    error: query.error,
    checking: enabled && (settled !== json || query.isFetching),
  };
}

/**
 * Shows a refused save's errors (422 `invalid_ruleset`) as `/validate`'s answer for the definition
 * that was sent, so they appear in the same places.
 */
export function useShowRefusedSave() {
  const queryClient = useQueryClient();
  return (definition: RulesetDefinition, errors: RuleError[]) => {
    queryClient.setQueryData<RulesetValidation>(validationQueryKey(JSON.stringify(definition)), {
      valid: false,
      errors,
      definition: null,
    });
  };
}
