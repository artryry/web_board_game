import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";

import { api } from "@/api/client";
import { unwrap } from "@/api/errors";

import { cardCountQuery } from "./useCards";

// Only `total` is read, so each list asks for the smallest page.
const COUNT_ONLY = { query: { limit: 1 } };

export interface LibraryCounts {
  cards: UseQueryResult<number>;
  cardGroups: UseQueryResult<number>;
  decks: UseQueryResult<number>;
}

/** How many cards, card groups and decks the user has, from each list endpoint's `total`. */
export function useLibraryCounts(): LibraryCounts {
  // The card library's group panel shows the same count, so it shares this query.
  const cards = useQuery(cardCountQuery());
  const [cardGroups, decks] = useQueries({
    queries: [
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
