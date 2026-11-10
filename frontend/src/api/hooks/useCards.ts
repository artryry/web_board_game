import { queryOptions, useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";
import { unwrap } from "@/api/errors";
import type { components } from "@/api/schema";

import { useRefreshCardsAndGroups } from "./useCardGroups";

export type Card = components["schemas"]["CardOut"];
export type CardKind = Card["kind"];
export type CardBody = components["schemas"]["CardCreate"];
export type CardUpdateBody = components["schemas"]["CardUpdate"];

/** The library's filters. `group` is a group id, or `"ungrouped"` for cards in no group. */
export interface CardFilters {
  group?: string | undefined;
  originId?: string | undefined;
  kind?: CardKind | undefined;
}

export const UNGROUPED = "ungrouped";
const CARDS_PER_PAGE = 50;

function filterQuery({ group, originId, kind }: CardFilters) {
  return {
    ...(group === UNGROUPED ? { ungrouped: true } : group === undefined ? {} : { group_id: group }),
    ...(originId === undefined ? {} : { origin_id: originId }),
    ...(kind === undefined ? {} : { kind }),
  };
}

/** The user's cards, newest first, loaded 50 at a time. */
export function useCards(filters: CardFilters) {
  return useInfiniteQuery({
    queryKey: ["cards", "list", filters],
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET("/api/cards", {
          params: { query: { ...filterQuery(filters), limit: CARDS_PER_PAGE, offset: pageParam } },
          signal,
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0);
      return lastPage.items.length > 0 && loaded < lastPage.total ? loaded : undefined;
    },
  });
}

/**
 * How many cards the user has, in all or in no group. The dashboard shares the `all` count.
 * Only `total` is read, so it asks for the smallest page.
 */
export function cardCountQuery(scope: "all" | "ungrouped" = "all") {
  return queryOptions({
    queryKey:
      scope === "all" ? (["cards", "count"] as const) : (["cards", "count", UNGROUPED] as const),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/cards", {
          params: { query: { limit: 1, ...(scope === "all" ? {} : { ungrouped: true }) } },
          signal,
        }),
      ).total,
  });
}

/** One card, or nothing while `id` is undefined. */
export function useCard(id: string | undefined) {
  return useQuery({
    queryKey: ["cards", "detail", id],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/cards/{card_id}", { params: { path: { card_id: id ?? "" } }, signal }),
      ),
    enabled: id !== undefined,
  });
}

// A card change refreshes the groups too, because their card counts change.

export function useCreateCard() {
  const refresh = useRefreshCardsAndGroups();
  return useMutation({
    mutationFn: async (body: CardBody) => unwrap(await api.POST("/api/cards", { body })),
    onSuccess: () => refresh(),
  });
}

/** Saves the editor's whole form, or moves a card with only `group_id`. */
export function useUpdateCard() {
  const refresh = useRefreshCardsAndGroups();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: CardUpdateBody }) =>
      unwrap(await api.PATCH("/api/cards/{card_id}", { params: { path: { card_id: id } }, body })),
    onSuccess: () => refresh(),
  });
}

export function useDeleteCard() {
  const refresh = useRefreshCardsAndGroups();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await api.DELETE("/api/cards/{card_id}", { params: { path: { card_id: id } } }));
    },
    onSuccess: (_data, id) => refresh(id),
  });
}
