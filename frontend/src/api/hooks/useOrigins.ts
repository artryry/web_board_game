import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { unwrap } from "@/api/errors";
import type { components } from "@/api/schema";

import { fetchAllPages } from "./fetchAllPages";

export type Origin = components["schemas"]["OriginOut"];
export type OriginBody = components["schemas"]["OriginCreate"];

/** Every origin the user can use: the system templates first, then their own, each by name. */
export function useOrigins() {
  return useQuery({
    queryKey: ["origins", "list"],
    queryFn: ({ signal }) =>
      fetchAllPages(async (offset, limit) =>
        unwrap(await api.GET("/api/origins", { params: { query: { offset, limit } }, signal })),
      ),
  });
}

/** One origin, or nothing while `id` is undefined. */
export function useOrigin(id: string | undefined) {
  return useQuery({
    queryKey: ["origins", "detail", id],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/origins/{origin_id}", {
          params: { path: { origin_id: id ?? "" } },
          signal,
        }),
      ),
    enabled: id !== undefined,
  });
}

// Every origin change refreshes all origin queries, so lists and pickers stay in step.
function useRefreshOrigins() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["origins"] });
}

export function useCreateOrigin() {
  const refresh = useRefreshOrigins();
  return useMutation({
    mutationFn: async (body: OriginBody) => unwrap(await api.POST("/api/origins", { body })),
    onSuccess: refresh,
  });
}

export function useUpdateOrigin() {
  const refresh = useRefreshOrigins();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: OriginBody }) =>
      unwrap(
        await api.PATCH("/api/origins/{origin_id}", { params: { path: { origin_id: id } }, body }),
      ),
    onSuccess: refresh,
  });
}

export function useDeleteOrigin() {
  const refresh = useRefreshOrigins();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await api.DELETE("/api/origins/{origin_id}", { params: { path: { origin_id: id } } }));
    },
    onSuccess: refresh,
  });
}
