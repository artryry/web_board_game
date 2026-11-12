import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { unwrap } from "@/api/errors";
import type { components } from "@/api/schema";

export type Deck = components["schemas"]["DeckOut"];
export type DeckSummary = components["schemas"]["DeckSummaryOut"];
export type DeckCardIn = components["schemas"]["DeckCardIn"];
export type DeckBody = components["schemas"]["DeckCreate"];

const DECKS_PER_PAGE = 50;

/** The user's decks, newest first, loaded 50 at a time. Summaries only: no card lists. */
export function useDecks() {
  return useInfiniteQuery({
    queryKey: ["decks", "list"],
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET("/api/decks", {
          params: { query: { limit: DECKS_PER_PAGE, offset: pageParam } },
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

export function deckQueryKey(id: string | undefined) {
  return ["decks", "detail", id] as const;
}

/** One deck with its cards, or nothing while `id` is undefined. */
export function useDeck(id: string | undefined) {
  return useQuery({
    queryKey: deckQueryKey(id),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/decks/{deck_id}", { params: { path: { deck_id: id ?? "" } }, signal }),
      ),
    enabled: id !== undefined,
  });
}

/**
 * Deck changes refresh every deck query, the dashboard's count included. A saved deck's own query
 * gets the server's answer straight away, so the builder doesn't load it again; a deleted deck's
 * query is left alone, since refetching it would only answer 404.
 */
function useRefreshDecks() {
  const queryClient = useQueryClient();
  return {
    saved: (deck: Deck) => {
      queryClient.setQueryData(deckQueryKey(deck.id), deck);
      return queryClient.invalidateQueries({
        queryKey: ["decks"],
        predicate: (query) => query.queryKey[2] !== deck.id,
      });
    },
    deleted: (id: string) =>
      queryClient.invalidateQueries({
        queryKey: ["decks"],
        predicate: (query) => query.queryKey[2] !== id,
      }),
  };
}

export function useCreateDeck() {
  const refresh = useRefreshDecks();
  return useMutation({
    mutationFn: async (body: DeckBody) => unwrap(await api.POST("/api/decks", { body })),
    onSuccess: (deck) => refresh.saved(deck),
  });
}

/** Saves the builder: `cards` always holds the whole list. */
export function useUpdateDeck() {
  const refresh = useRefreshDecks();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: DeckBody }) =>
      unwrap(await api.PATCH("/api/decks/{deck_id}", { params: { path: { deck_id: id } }, body })),
    onSuccess: (deck) => refresh.saved(deck),
  });
}

export function useDeleteDeck() {
  const refresh = useRefreshDecks();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await api.DELETE("/api/decks/{deck_id}", { params: { path: { deck_id: id } } }));
    },
    onSuccess: (_data, id) => refresh.deleted(id),
  });
}
