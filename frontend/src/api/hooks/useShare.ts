import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { unwrap } from "@/api/errors";
import type { components } from "@/api/schema";

import { deckQueryKey } from "./useDecks";
import { rulesetQueryKey } from "./useRulesets";

/** What the share dialog can share. */
export type ShareKind = "deck" | "card_group" | "ruleset";

export type DeckPreview = components["schemas"]["DeckPreview"];
export type CardGroupPreview = components["schemas"]["CardGroupPreview"];
export type RulesetPreview = components["schemas"]["RulesetPreview"];
export type SharePreview = DeckPreview | CardGroupPreview | RulesetPreview;

// The share code shows on decks, groups and rulesets, so a change refreshes their lists. An open
// preview of the code may now answer differently, so it goes too.
const REFRESHED_BY_KIND = {
  deck: ["decks"],
  card_group: ["card-groups"],
  ruleset: ["rulesets"],
} as const;

function useRefreshShared(kind: ShareKind) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: REFRESHED_BY_KIND[kind] }),
      queryClient.invalidateQueries({ queryKey: ["share"] }),
    ]);
}

const SHARE_CALLS = {
  deck: {
    create: (id: string) =>
      api.POST("/api/decks/{deck_id}/share", { params: { path: { deck_id: id } } }),
    revoke: (id: string) =>
      api.DELETE("/api/decks/{deck_id}/share", { params: { path: { deck_id: id } } }),
  },
  card_group: {
    create: (id: string) =>
      api.POST("/api/card-groups/{group_id}/share", { params: { path: { group_id: id } } }),
    revoke: (id: string) =>
      api.DELETE("/api/card-groups/{group_id}/share", { params: { path: { group_id: id } } }),
  },
  ruleset: {
    create: (id: string) =>
      api.POST("/api/rulesets/{ruleset_id}/share", { params: { path: { ruleset_id: id } } }),
    revoke: (id: string) =>
      api.DELETE("/api/rulesets/{ruleset_id}/share", { params: { path: { ruleset_id: id } } }),
  },
};

async function createShareCode(kind: ShareKind, id: string) {
  return unwrap(await SHARE_CALLS[kind].create(id)).share_code;
}

async function revokeShareCode(kind: ShareKind, id: string) {
  unwrap(await SHARE_CALLS[kind].revoke(id));
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
 * new group) and any custom origins, so every library list is refreshed. The copied deck or
 * ruleset is cached, so the page the import lands on shows it at once.
 */
export function useImportShare(code: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/api/share/{code}/import", { params: { path: { code } } })),
    onSuccess: (result) => {
      let copiedId: string | null = null;
      if (result.kind === "deck") {
        queryClient.setQueryData(deckQueryKey(result.deck.id), result.deck);
        copiedId = result.deck.id;
      }
      if (result.kind === "ruleset") {
        queryClient.setQueryData(rulesetQueryKey(result.ruleset.id), result.ruleset);
        copiedId = result.ruleset.id;
      }
      return Promise.all(
        ["decks", "cards", "card-groups", "origins", "rulesets"].map((key) =>
          queryClient.invalidateQueries({
            queryKey: [key],
            predicate: (query) => copiedId === null || query.queryKey[2] !== copiedId,
          }),
        ),
      );
    },
  });
}
