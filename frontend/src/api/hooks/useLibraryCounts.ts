import { useQueries, type UseQueryResult } from "@tanstack/react-query";

import { api } from "@/api/client";
import { unwrap } from "@/api/errors";

// Only `total` is read, so each list asks for the smallest page.
const COUNT_ONLY = { query: { limit: 1 } };

export interface LibraryCounts {
  cards: UseQueryResult<number>;
  cardGroups: UseQueryResult<number>;
  decks: UseQueryResult<number>;
}

/** How many cards, card groups and decks the user has, from each list endpoint's `total`. */
export function useLibraryCounts(): LibraryCounts {
  const [cards, cardGroups, decks] = useQueries({
    queries: [
      {
        queryKey: ["cards", "count"],
        queryFn: async ({ signal }) =>
          unwrap(await api.GET("/api/cards", { params: COUNT_ONLY, signal })).total,
      },
      {
        queryKey: ["card-groups", "count"],
        queryFn: async ({ signal }) =>
          unwrap(await api.GET("/api/card-groups", { params: COUNT_ONLY, signal })).total,
      },
      {
        queryKey: ["decks", "count"],
        queryFn: async ({ signal }) =>
          unwrap(await api.GET("/api/decks", { params: COUNT_ONLY, signal })).total,
      },
    ],
  });
  return { cards, cardGroups, decks };
}
