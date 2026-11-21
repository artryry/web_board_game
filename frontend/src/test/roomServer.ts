import { ws } from "msw";

import type { ClientMessage, EndReason, ErrorPayload, Seat, ServerMessage } from "@/ws/messages";
import { roomSocketUrl } from "@/ws/socket";

import { gameStateMessage, gameView } from "./gameViewFixture";
import { FIRST_ACCESS, REFRESHED_ACCESS } from "./handlers";
import {
  ALICE,
  findPlayer,
  roomStateFor,
  roomStore,
  type FakeClient,
  type FakePlayer,
  type FakeRoom,
} from "./roomStore";

// A fake game socket (backend app/ws/handler.py and room_service.py) for alice, over the fake
// room store: `auth` first, the full state on connect, the lobby's messages, and a game that
// starts when both are ready and ends on surrender. Tests move bob with `updateRoom` and can
// close alice's socket with any code (`closeRoomSocket`).

const VALID_ACCESS = new Set([FIRST_ACCESS, REFRESHED_ACCESS]);

export const roomSocket = ws.link(roomSocketUrl(":code"));

function send(client: FakeClient, message: ServerMessage): void {
  client.send(JSON.stringify(message));
}

/**
 * Closes after the messages already sent: MSW delivers a message in a microtask and drops it if
 * the socket is closing by then, where a real server's stream keeps the order.
 */
function closeAfterSends(client: FakeClient, code: number): void {
  queueMicrotask(() => {
    client.close(code);
  });
}

function sendRoomState(client: FakeClient, room: FakeRoom): void {
  send(client, { type: "room_state", payload: roomStateFor(room) });
}

function sendError(
  client: FakeClient,
  seq: number,
  reason: "deck_not_found" | "deck_not_playable" | "no_deck" | "not_in_game",
  message: string,
  problems: ErrorPayload["problems"] = null,
): void {
  send(client, { type: "error", payload: { seq, reason, message, problems } });
}

export const roomSocketHandlers = [
  roomSocket.addEventListener("connection", ({ client, params }) => {
    const code = String(params.code);
    let authed = false;

    client.addEventListener("message", (event) => {
      // RoomSocket sends text frames only.
      if (typeof event.data !== "string") throw new Error("A binary frame reached the room");
      const message = JSON.parse(event.data) as ClientMessage;
      roomStore.sent.push(message);
      if (authed) {
        receive(code, client, message);
        return;
      }
      if (message.type !== "auth" || !VALID_ACCESS.has(message.payload.token)) {
        client.close(4401);
        return;
      }
      const refusal = roomStore.refusals.shift();
      if (refusal !== undefined) {
        client.close(refusal);
        return;
      }
      authed = true;
      const room = roomStore.rooms.get(code);
      if (room === undefined) {
        client.close(4404);
        return;
      }
      const alice = findPlayer(room, ALICE.user_id);
      if (alice === undefined) {
        client.close(4403);
        return;
      }
      // One socket per player: a newer one replaces the older.
      const older = roomStore.clients.get(code);
      if (older !== undefined) closeAfterSends(older, 4409);
      roomStore.clients.set(code, client);
      alice.connected = true;
      alice.away_since = null;
      sendRoomState(client, room);
      if (room.view !== null) send(client, gameStateMessage(room.view));
    });

    client.addEventListener("close", () => {
      if (roomStore.clients.get(code) !== client) return;
      roomStore.clients.delete(code);
      const room = roomStore.rooms.get(code);
      const alice = room === undefined ? undefined : findPlayer(room, ALICE.user_id);
      if (alice === undefined) return;
      alice.connected = false;
      if (room?.status === "lobby") alice.ready = false;
    });
  }),
];

function receive(code: string, client: FakeClient, message: ClientMessage): void {
  const room = roomStore.rooms.get(code);
  const alice = room === undefined ? undefined : findPlayer(room, ALICE.user_id);
  if (room === undefined || alice === undefined) return;

  switch (message.type) {
    case "select_deck": {
      const deck = roomStore.decks.find((candidate) => candidate.id === message.payload.deck_id);
      if (deck === undefined) {
        sendError(client, message.seq, "deck_not_found", "Deck not found");
      } else if (deck.problems.length > 0) {
        const text = "This deck doesn't fit the room's rules";
        sendError(client, message.seq, "deck_not_playable", text, deck.problems);
      } else {
        alice.deckId = deck.id;
        alice.ready = false;
        sendRoomState(client, room);
      }
      return;
    }
    case "ready": {
      if (message.payload.ready && alice.deckId === null) {
        sendError(client, message.seq, "no_deck", "Select a deck first");
        return;
      }
      alice.ready = message.payload.ready;
      const allReady =
        room.players.length === 2 &&
        room.players.every((member) => member.ready && member.deckId !== null);
      if (allReady) startGame(room, client);
      else sendRoomState(client, room);
      return;
    }
    case "leave":
      if (alice.is_host) {
        send(client, { type: "room_closed", payload: null });
        roomStore.rooms.delete(code);
      } else {
        room.players = room.players.filter((member) => member !== alice);
      }
      roomStore.clients.delete(code);
      closeAfterSends(client, 1000);
      return;
    case "action":
      if (room.status !== "playing" || room.view === null) {
        sendError(client, message.seq, "not_in_game", "No game is running");
        return;
      }
      if (message.payload.type === "surrender") {
        finishGame(room, client, room.view.seat === 0 ? 1 : 0, "surrender");
      }
      return;
    case "ping":
      send(client, { type: "pong", payload: null });
      return;
    case "resync":
      sendRoomState(client, room);
      if (room.view !== null) send(client, gameStateMessage(room.view));
      return;
    case "auth":
      return;
  }
}

function startGame(room: FakeRoom, client: FakeClient): void {
  room.status = "playing";
  for (const member of room.players) {
    member.seat = member.is_host ? room.hostSeat : room.hostSeat === 0 ? 1 : 0;
  }
  room.view = gameView({ seat: findPlayer(room, ALICE.user_id)?.seat ?? 0 });
  sendRoomState(client, room);
  send(client, { type: "events", payload: { seq: null, events: [] } });
  send(client, gameStateMessage(room.view));
}

/** Ends the game as the server does: events, the final view, `game_over`, then the room. */
export function finishGame(
  room: FakeRoom,
  client: FakeClient | undefined,
  winner: Seat | null,
  reason: EndReason,
): void {
  if (room.view === null) throw new Error("No game to finish");
  room.status = "finished";
  room.view = {
    ...room.view,
    version: room.view.version + 1,
    status: "finished",
    winner,
    end_reason: reason,
  };
  if (client === undefined) return;
  send(client, { type: "events", payload: { seq: null, events: [] } });
  send(client, gameStateMessage(room.view));
  send(client, { type: "game_over", payload: { winner, reason } });
  sendRoomState(client, room);
}

/** Changes the room (bob joins, readies, goes away …) and sends alice the new state. */
export function updateRoom(code: string, change: (room: FakeRoom) => void): void {
  const room = roomStore.rooms.get(code);
  if (room === undefined) throw new Error(`No room ${code}`);
  change(room);
  const client = roomStore.clients.get(code);
  if (client !== undefined) sendRoomState(client, room);
}

/** Changes one player (bob connects, picks a deck, gets ready …) and sends alice the room. */
export function updatePlayer(code: string, userId: string, fields: Partial<FakePlayer>): void {
  updateRoom(code, (room) => {
    const member = findPlayer(room, userId);
    if (member === undefined) throw new Error(`No player ${userId} in room ${code}`);
    Object.assign(member, fields);
  });
}

/** Sends alice's socket in this room any message. */
export function sendToRoom(code: string, message: ServerMessage | string): void {
  const client = roomStore.clients.get(code);
  if (client === undefined) throw new Error(`Alice has no socket in room ${code}`);
  client.send(typeof message === "string" ? message : JSON.stringify(message));
}

/** Closes alice's socket in this room, as the server would with `code`. */
export function closeRoomSocket(code: string, closeCode: number): void {
  const client = roomStore.clients.get(code);
  if (client === undefined) throw new Error(`Alice has no socket in room ${code}`);
  roomStore.clients.delete(code);
  closeAfterSends(client, closeCode);
}

/** The host (bob) closes the room: `room_closed`, then 1000. */
export function closeRoomByHost(code: string): void {
  const client = roomStore.clients.get(code);
  roomStore.rooms.delete(code);
  if (client === undefined) return;
  roomStore.clients.delete(code);
  send(client, { type: "room_closed", payload: null });
  closeAfterSends(client, 1000);
}

/** Whether alice's socket in this room is open. */
export function isConnected(code: string): boolean {
  return roomStore.clients.has(code);
}

/** The messages alice sent of one type, oldest first. */
export function sentOfType<T extends ClientMessage["type"]>(
  type: T,
): Extract<ClientMessage, { type: T }>[] {
  return roomStore.sent.filter(
    (message): message is Extract<ClientMessage, { type: T }> => message.type === type,
  );
}
