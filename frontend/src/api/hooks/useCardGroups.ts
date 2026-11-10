import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { unwrap } from "@/api/errors";
import type { components } from "@/api/schema";

import { fetchAllPages } from "./fetchAllPages";

export type CardGroup = components["schemas"]["CardGroupOut"];

/** Every card group of the user, by name, with its card count. */
export function useCardGroups() {
  return useQuery({
    queryKey: ["card-groups", "list"],
    queryFn: ({ signal }) =>
      fetchAllPages(async (offset, limit) =>
        unwrap(await api.GET("/api/card-groups", { params: { query: { offset, limit } }, signal })),
      ),
  });
}

/**
 * Group changes refresh the cards too: deleting a group leaves its cards ungrouped, and the
 * library's counts come from both. A deleted card's own query is left alone: refetching it would
 * only turn the closing editor into a 404.
 */
export function useRefreshCardsAndGroups() {
  const queryClient = useQueryClient();
  return (deletedCardId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["cards"],
        predicate: (query) => deletedCardId === undefined || query.queryKey[2] !== deletedCardId,
      }),
      queryClient.invalidateQueries({ queryKey: ["card-groups"] }),
    ]);
}

export function useCreateCardGroup() {
  const refresh = useRefreshCardsAndGroups();
  return useMutation({
    mutationFn: async (name: string) =>
      unwrap(await api.POST("/api/card-groups", { body: { name } })),
    onSuccess: () => refresh(),
  });
}

export function useRenameCardGroup() {
  const refresh = useRefreshCardsAndGroups();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      unwrap(
        await api.PATCH("/api/card-groups/{group_id}", {
          params: { path: { group_id: id } },
          body: { name },
        }),
      ),
    onSuccess: () => refresh(),
  });
}

export function useDeleteCardGroup() {
  const refresh = useRefreshCardsAndGroups();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(
        await api.DELETE("/api/card-groups/{group_id}", { params: { path: { group_id: id } } }),
      );
    },
    onSuccess: () => refresh(),
  });
}
