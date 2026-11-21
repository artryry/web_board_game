import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { unwrap } from "@/api/errors";
import type { components } from "@/api/schema";

import { fetchAllPages } from "./fetchAllPages";

export type RoomState = components["schemas"]["RoomState"];
export type RoomPlayer = components["schemas"]["RoomPlayerOut"];
export type RoomDeck = components["schemas"]["RoomDeckOut"];
export type RoomDeckProblem = RoomDeck["problems"][number];

// The room's own state (players, ready, the game) is live and comes from the game socket, in
// ws/gameStore.ts. These are the REST calls around it: creating and joining a room, the
// dashboard's look at the last room, and the user's decks checked against the room's rules.

function handOffKey(code: string) {
  return ["rooms", "handoff", code] as const;
}

export function roomDecksKey(code: string) {
  return ["rooms", "decks", code] as const;
}

async function joinRoom(code: string, signal?: AbortSignal): Promise<RoomState> {
  return unwrap(await api.POST("/api/rooms/join", { body: { code }, signal }));
}

export function useCreateRoom() {
  return useMutation({
    mutationFn: async (rulesetId: string) =>
      unwrap(await api.POST("/api/rooms", { body: { ruleset_id: rulesetId } })),
  });
}

/** The join dialog's join. */
export function useJoinRoom() {
  return useMutation({ mutationFn: (code: string) => joinRoom(code) });
}

/**
 * Gives a create or join answer to the room page, which then doesn't join again. The page takes
 * it once (`useRoomMembership`), so a later visit joins again.
 */
export function handOffRoom(queryClient: QueryClient, room: RoomState): void {
  queryClient.setQueryData(handOffKey(room.code), room);
}

/**
 * The room page's join, with an upper-case `code`. A member gets the same answer again, so the
 * host, a returning player and an invited one all take this one path: the link is the invitation.
 * It runs once per visit: `gcTime: 0` drops the answer when the page unmounts, so the next visit
 * joins again (a guest who left must, or the socket would refuse them).
 */
export function useRoomMembership(code: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["rooms", "membership", code],
    queryFn: async ({ signal }) => {
      const handed = queryClient.getQueryData<RoomState>(handOffKey(code));
      if (handed !== undefined) {
        queryClient.removeQueries({ queryKey: handOffKey(code), exact: true });
        return handed;
      }
      return joinRoom(code, signal);
    },
    staleTime: Infinity,
    gcTime: 0,
  });
}

/** A room the user is in, or nothing while `code` is null. 404 when it's gone or they left it. */
export function useRoom(code: string | null) {
  return useQuery({
    queryKey: ["rooms", "detail", code],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/rooms/{code}", { params: { path: { code: code ?? "" } }, signal }),
      ),
    enabled: code !== null,
  });
}

/**
 * The user's decks, each with its `problems` under the room's rules. Always stale, so it loads
 * again when the tab gets the focus back: the user may have fixed a deck in another tab.
 */
export function useRoomDecks(code: string) {
  return useQuery({
    queryKey: roomDecksKey(code),
    queryFn: ({ signal }) =>
      fetchAllPages(async (offset, limit) =>
        unwrap(
          await api.GET("/api/rooms/{code}/decks", {
            params: { path: { code }, query: { offset, limit } },
            signal,
          }),
        ),
      ),
    staleTime: 0,
  });
}
