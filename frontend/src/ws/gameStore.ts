import { create } from "zustand";

import type { RoomDeckProblem, RoomState } from "@/api/hooks/useRooms";

import type {
  EndReason,
  ErrorPayload,
  LegalAction,
  PlayerView,
  Seat,
  ServerMessage,
} from "./messages";
import { RoomSocket, type ConnectionState } from "./socket";

// The live room and game (coding-standards §3): what the room page renders, filled by the game
// socket. One room at a time: the room page opens it on mount and closes it on unmount. REST data
// (decks, rule sets, origins) stays in TanStack Query. F5 adds the legal-actions index, the
// event queue and the pending action.

export interface GameSnapshot {
  view: PlayerView;
  legalActions: LegalAction[];
  /** When the current phase times out, in the server's Unix ms, or null. */
  deadline: number | null;
}

export interface GameResult {
  winner: Seat | null;
  reason: EndReason;
}

/** A refused `select_deck`, shown at the deck it was for. */
export interface DeckError {
  deckId: string;
  reason: "deck_not_playable" | "deck_not_found";
  problems: RoomDeckProblem[];
}

export interface RoomData {
  /** The open room's code, or null before the room page opens one. */
  code: string | null;
  connection: ConnectionState;
  room: RoomState | null;
  game: GameSnapshot | null;
  /** The server's clock minus ours, in ms, from the latest `game_state`. */
  clockOffset: number;
  result: GameResult | null;
  /** The last refusal that isn't about a deck. The next `room_state` clears it. */
  lastError: ErrorPayload | null;
  deckError: DeckError | null;
  /** The last `select_deck`'s seq and deck: an error that answers it is about that deck. */
  pendingDeck: { seq: number; deckId: string } | null;
}

interface RoomCommands {
  /** Starts from the join's answer, so the lobby draws before the socket answers. */
  openRoom: (code: string, room: RoomState) => void;
  closeRoom: () => void;
  selectDeck: (deckId: string) => void;
  setReady: (ready: boolean) => void;
  leave: () => void;
  surrender: () => void;
  /** Connects again after another tab took over (4409) or the sign-in failed. */
  reconnect: () => void;
  dismissError: () => void;
}

export function emptyRoomData(): RoomData {
  return {
    code: null,
    connection: { status: "connecting" },
    room: null,
    game: null,
    clockOffset: 0,
    result: null,
    lastError: null,
    deckError: null,
    pendingDeck: null,
  };
}

/** How a server message changes the room, `now` being `Date.now()` when it arrived. */
export function applyServerMessage(
  state: RoomData,
  message: ServerMessage,
  now: number,
): Partial<RoomData> {
  switch (message.type) {
    case "room_state":
      return { room: message.payload, lastError: null };
    case "game_state": {
      const { view, legal_actions, deadline, server_time } = message.payload;
      return {
        game: { view, legalActions: legal_actions, deadline },
        clockOffset: server_time - now,
      };
    }
    case "game_over":
      return { result: { winner: message.payload.winner, reason: message.payload.reason } };
    case "error":
      return errorChange(state, message.payload);
    // `events` waits for F5's event queue. `room_closed` is the socket's: the close that
    // follows ends the connection. `pong` never gets here.
    case "events":
    case "room_closed":
    case "pong":
      return {};
  }
}

function errorChange(state: RoomData, error: ErrorPayload): Partial<RoomData> {
  const { reason, seq, problems } = error;
  const pending = state.pendingDeck;
  if (
    (reason === "deck_not_playable" || reason === "deck_not_found") &&
    pending !== null &&
    seq === pending.seq
  ) {
    return {
      deckError: { deckId: pending.deckId, reason, problems: problems ?? [] },
      pendingDeck: null,
    };
  }
  return { lastError: error };
}

let socket: RoomSocket | null = null;

export const useGameStore = create<RoomData & RoomCommands>()((set) => ({
  ...emptyRoomData(),

  openRoom: (code, room) => {
    socket?.close();
    const opened = new RoomSocket(code, {
      onMessage: (message) => {
        if (socket === opened) set((state) => applyServerMessage(state, message, Date.now()));
      },
      onConnection: (connection) => {
        if (socket === opened) set({ connection });
      },
    });
    socket = opened;
    set({ ...emptyRoomData(), code, room });
    opened.connect();
  },

  // The store forgets the room too, so a later visit never draws this one's last state.
  closeRoom: () => {
    socket?.close();
    socket = null;
    set(emptyRoomData());
  },

  selectDeck: (deckId) => {
    const seq = socket?.send({ type: "select_deck", payload: { deck_id: deckId } }) ?? null;
    set({ deckError: null, pendingDeck: seq === null ? null : { seq, deckId } });
  },

  setReady: (ready) => {
    socket?.send({ type: "ready", payload: { ready } });
  },

  leave: () => {
    socket?.leave();
  },

  surrender: () => {
    socket?.send({ type: "action", payload: { type: "surrender" } });
  },

  reconnect: () => {
    socket?.reconnect();
  },

  dismissError: () => {
    set({ lastError: null });
  },
}));
