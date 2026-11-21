import { http, HttpResponse } from "msw";

import { contentStore } from "./contentStore";
import { apiError, apiUrl, authorized } from "./handlers";
import { pageOf, readBody } from "./handlerUtils";
import { ALICE, addRoom, findPlayer, roomStateFor, roomStore, type FakeRoom } from "./roomStore";

// The Rooms REST routes (backend app/api/rooms.py) over the fake room store, for alice.

interface CodeParams {
  code: string;
}

export const roomNotFound = () => apiError(404, "room_not_found", "Room not found");

/** The room, when alice is in it: the API answers 404 to anyone else. */
function memberRoom(code: string): FakeRoom | undefined {
  const room = roomStore.rooms.get(code);
  return room !== undefined && findPlayer(room, ALICE.user_id) !== undefined ? room : undefined;
}

export const roomHandlers = [
  http.post(
    apiUrl("/api/rooms"),
    authorized(async ({ request }) => {
      const body = await readBody(request);
      const ruleset = contentStore.rulesets.find((candidate) => candidate.id === body.ruleset_id);
      if (ruleset === undefined) return apiError(404, "ruleset_not_found", "Ruleset not found");
      const room = addRoom({
        ruleset: { id: ruleset.id, name: ruleset.name, definition: ruleset.definition },
      });
      return HttpResponse.json(roomStateFor(room), { status: 201 });
    }),
  ),

  http.post(
    apiUrl("/api/rooms/join"),
    authorized(async ({ request }) => {
      const body = await readBody(request);
      const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      const room = roomStore.rooms.get(code);
      if (room === undefined) return roomNotFound();
      if (findPlayer(room, ALICE.user_id) === undefined) {
        if (room.status !== "lobby" || room.players.length >= 2) {
          return apiError(409, "room_full", "This room is full");
        }
        room.players.push({
          ...ALICE,
          is_host: false,
          connected: false,
          deckId: null,
          ready: false,
          seat: null,
          away_since: null,
        });
      }
      return HttpResponse.json(roomStateFor(room));
    }),
  ),

  http.get<CodeParams>(
    apiUrl("/api/rooms/:code"),
    authorized<CodeParams, Response>(({ params }) => {
      const room = memberRoom(params.code);
      return room === undefined ? roomNotFound() : HttpResponse.json(roomStateFor(room));
    }),
  ),

  http.get<CodeParams>(
    apiUrl("/api/rooms/:code/decks"),
    authorized<CodeParams, Response>(({ params, request }) =>
      memberRoom(params.code) === undefined ? roomNotFound() : pageOf(roomStore.decks, request),
    ),
  ),
];
