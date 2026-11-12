import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { unwrap } from "@/api/errors";
import type { components } from "@/api/schema";

import { deckQueryKey } from "./useDecks";

/** What the share dialog can share. Rulesets get theirs with the rules editor (F3). */
export type ShareKind = "deck" | "card_group";

export type DeckPreview = components["schemas"]["DeckPreview"];
export type CardGroupPreview = components["schemas"]["CardGroupPreview"];
export type RulesetPreview = components["schemas"]["RulesetPreview"];
export type SharePreview = DeckPreview | CardGroupPreview | RulesetPreview;

// The share code shows on decks and groups, so a change refreshes their lists. An open preview of
// the code may now answer differently, so it goes too.
const REFRESHED_BY_KIND = { deck: ["decks"], card_group: ["card-groups"] } as const;

function useRefreshShared(kind: ShareKind) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: REFRESHED_BY_KIND[kind] }),
      queryClient.invalidateQueries({ queryKey: ["share"] }),
    ]);
}

async function createShareCode(kind: ShareKind, id: string) {
  const result =
    kind === "deck"
      ? await api.POST("/api/decks/{deck_id}/share", { params: { path: { deck_id: id } } })
      : await api.POST("/api/card-groups/{group_id}/share", {
          params: { path: { group_id: id } },
        });
  return unwrap(result).share_code;
}

async function revokeShareCode(kind: ShareKind, id: string) {
  const result =
    kind === "deck"
      ? await api.DELETE("/api/decks/{deck_id}/share", { params: { path: { deck_id: id } } })
      : await api.DELETE("/api/card-groups/{group_id}/share", {
          params: { path: { group_id: id } },
        });
  unwrap(result);
}

/** Makes a share code, or returns the existing one. */
export function useShare(kind: ShareKind) {
  const refresh = useRefreshShared(kind);
  return useMutation({
    mutationFn: (id: string) => createShareCode(kind, id),
    onSuccess: () => refresh(),
  });
}

/** Removes the share code: the old link stops working, and sharing again makes a new code. */
export function useRevokeShare(kind: ShareKind) {
  const refresh = useRefreshShared(kind);
  return useMutation({
    mutationFn: (id: string) => revokeShareCode(kind, id),
    onSuccess: () => refresh(),
  });
}

/** What a share code holds now. The author's later edits show up here. */
export function useSharePreview(code: string) {
  return useQuery({
    queryKey: ["share", code],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/share/{code}", { params: { path: { code } }, signal })),
  });
}

/**
 * Copies the shared deck, group or ruleset into the user's library. A deck brings its cards (in a
 * new group) and any custom origins, so every library list is refreshed.
 */
export function useImportShare(code: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/api/share/{code}/import", { params: { path: { code } } })),
    onSuccess: (result) => {
      if (result.kind === "deck") {
        queryClient.setQueryData(deckQueryKey(result.deck.id), result.deck);
      }
      return Promise.all(
        ["decks", "cards", "card-groups", "origins", "rulesets"].map((key) =>
          queryClient.invalidateQueries({
            queryKey: [key],
            predicate: (query) => result.kind !== "deck" || query.queryKey[2] !== result.deck.id,
          }),
        ),
      );
    },
  });
}
