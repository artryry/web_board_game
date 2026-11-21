import type { RoomDeck, RoomDeckProblem, RoomState } from "@/api/hooks/useRooms";
import type { ClientMessage, PlayerView, Seat } from "@/ws/messages";

import { SYSTEM_ORIGIN_IDS } from "./contentStore";
import { TEST_USER } from "./handlers";
import { DEFAULT_RULESET_ID, rulesetsFixture } from "./rulesetFixture";

// The fake rooms behind the REST handlers (roomHandlers.ts) and the fake game socket
// (roomServer.ts), reset after every test (setup.ts). The test user, alice, is the only one with
// a socket; bob, the other player, is moved by the test itself (`updateRoom`).

export const BOB = { user_id: "00000000-0000-4000-8000-000000000002", username: "bob" };

export interface FakePlayer {
  user_id: string;
  username: string;
  is_host: boolean;
  connected: boolean;
  /** The chosen deck's id. */
  deckId: string | null;
  ready: boolean;
  seat: Seat | null;
  away_since: number | null;
}

export interface FakeRoom {
  code: string;
  status: RoomState["status"];
  ruleset: RoomState["ruleset"];
  players: FakePlayer[];
  /** Alice's view of the game, once it has started. */
  view: PlayerView | null;
  /** The host's seat when the game starts (the server flips a coin). */
  hostSeat: Seat;
}

/** What a socket handle needs: the fake server sends to alice and closes her socket. */
export interface FakeClient {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

interface RoomStore {
  rooms: Map<string, FakeRoom>;
  /** Alice's decks, as the room's deck list gives them. */
  decks: RoomDeck[];
  /** Every message alice's sockets sent, oldest first. */
  sent: ClientMessage[];
  /** Alice's open socket, by room code. */
  clients: Map<string, FakeClient>;
  /** Close codes for the next connections, one each, right after their `auth` (4401, 1011 …). */
  refusals: number[];
  nextRoom: number;
  nextDeck: number;
}

const CODES = ["ABC234", "XYZ789", "KMN456", "PQR523"];

function emptyStore(): RoomStore {
  return {
    rooms: new Map(),
    decks: [],
    sent: [],
    clients: new Map(),
    refusals: [],
    nextRoom: 0,
    nextDeck: 1,
  };
}

export const roomStore: RoomStore = emptyStore();

export function resetRoomStore(): void {
  Object.assign(roomStore, emptyStore());
}

export const ALICE = { user_id: TEST_USER.id, username: TEST_USER.username };

function player(user: { user_id: string; username: string }, isHost: boolean): FakePlayer {
  return {
    ...user,
    is_host: isHost,
    connected: false,
    deckId: null,
    ready: false,
    seat: null,
    away_since: null,
  };
}

type Who = "alice" | "bob";

interface RoomFields {
  code?: string;
  /** Who made the room: alice by default. */
  host?: Who;
  /** Who joined it: nobody by default. */
  guest?: Who | null;
  status?: RoomState["status"];
  ruleset?: RoomState["ruleset"];
}

const USERS = { alice: ALICE, bob: BOB };
const DEFAULT_RULESET = rulesetsFixture().find((ruleset) => ruleset.id === DEFAULT_RULESET_ID);

export function addRoom(fields: RoomFields = {}): FakeRoom {
  const code = fields.code ?? CODES[roomStore.nextRoom % CODES.length] ?? "ABC234";
  roomStore.nextRoom += 1;
  const players = [player(USERS[fields.host ?? "alice"], true)];
  const guest = fields.guest ?? null;
  if (guest !== null) players.push(player(USERS[guest], false));
  if (DEFAULT_RULESET === undefined) throw new Error("The fixture has no default rule set");
  const room: FakeRoom = {
    code,
    status: fields.status ?? "lobby",
    ruleset: fields.ruleset ?? {
      id: DEFAULT_RULESET.id,
      name: DEFAULT_RULESET.name,
      definition: DEFAULT_RULESET.definition,
    },
    players,
    view: null,
    hostSeat: 0,
  };
  roomStore.rooms.set(code, room);
  return room;
}

/** One of alice's decks, playable unless it has `problems`. */
export function addRoomDeck(
  name: string,
  fields: { problems?: RoomDeckProblem[]; cardCount?: number; originId?: string } = {},
): RoomDeck {
  const deck: RoomDeck = {
    id: `40000000-0000-4000-8000-${String(roomStore.nextDeck).padStart(12, "0")}`,
    name,
    origin_id: fields.originId ?? SYSTEM_ORIGIN_IDS.forest,
    card_count: fields.cardCount ?? 30,
    problems: fields.problems ?? [],
  };
  roomStore.nextDeck += 1;
  roomStore.decks.push(deck);
  return deck;
}

/** Seats bob (or alice) as the room's guest. */
export function seatGuest(room: FakeRoom, who: Who, fields: Partial<FakePlayer> = {}): void {
  room.players.push({ ...player(USERS[who], false), ...fields });
}

export function findPlayer(room: FakeRoom, userId: string): FakePlayer | undefined {
  return room.players.find((candidate) => candidate.user_id === userId);
}

/** The room as the API gives it to alice. */
export function roomStateFor(room: FakeRoom): RoomState {
  const alice = findPlayer(room, ALICE.user_id);
  const deck = roomStore.decks.find((candidate) => candidate.id === alice?.deckId);
  return {
    code: room.code,
    status: room.status,
    ruleset: room.ruleset,
    players: room.players.map((member) => ({
      user_id: member.user_id,
      username: member.username,
      is_host: member.is_host,
      connected: member.connected,
      has_deck: member.deckId !== null,
      ready: member.ready,
      seat: member.seat,
      away_since: member.away_since,
    })),
    my_deck:
      deck === undefined
        ? null
        : { id: deck.id, name: deck.name, origin_id: deck.origin_id, card_count: deck.card_count },
  };
}
