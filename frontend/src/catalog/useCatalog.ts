import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";
import { unwrap } from "@/api/errors";
import type { components } from "@/api/schema";

export type Catalog = components["schemas"]["CatalogOut"];
export type FeatureSpec = components["schemas"]["FeatureOut"];
export type SpellSpec = components["schemas"]["SpellOut"];
export type FieldEffectSpec = components["schemas"]["FieldEffectOut"];
export type ModuleRef = components["schemas"]["ModuleRef"];

/** What every catalog module has, whatever its kind. */
export interface ModuleSpec {
  key: string;
  name: string;
  description: string;
  params_schema: Record<string, unknown>;
}

/**
 * The module catalog, loaded once per session. It changes only when the backend is deployed, so
 * it never goes stale; logout clears it with the rest of the cache.
 */
export function useCatalog() {
  return useQuery({
    queryKey: ["catalog"],
    queryFn: async ({ signal }) => unwrap(await api.GET("/api/catalog", { signal })),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function findModule<M extends { key: string }>(
  modules: readonly M[],
  key: string,
): M | undefined {
  return modules.find((module) => module.key === key);
}
