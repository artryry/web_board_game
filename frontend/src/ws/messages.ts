import { isRecord } from "@/api/errors";
import type { components } from "@/api/schema";

// The game socket's messages (backend_plan §9.2), typed from the server's OpenAPI components.
// Client messages are `{type, seq, payload}`; server messages are `{type, payload}`.

type Schemas = components["schemas"];

export type ClientMessage =
  | Schemas["AuthMessage"]
  | Schemas["SelectDeckMessage"]
  | Schemas["ReadyMessage"]
  | Schemas["LeaveMessage"]
  | Schemas["ActionMessage"]
  | Schemas["PingMessage"]
  | Schemas["ResyncMessage"];

export type ServerMessage =
  | Schemas["RoomStateMessage"]
  | Schemas["GameStateMessage"]
  | Schemas["EventsMessage"]
  | Schemas["ErrorMessage"]
  | Schemas["GameOverMessage"]
  | Schemas["RoomClosedMessage"]
  | Schemas["PongMessage"];

/** A message the room page sends: `RoomSocket` adds its `seq`, and sends `auth` itself. */
export type OutgoingMessage = WithoutSeq<Exclude<ClientMessage, Schemas["AuthMessage"]>>;

type WithoutSeq<M> = M extends unknown ? Omit<M, "seq"> : never;

export type PlayerView = Schemas["PlayerView"];
export type GameStatePayload = Schemas["GameStatePayload"];
export type LegalAction = GameStatePayload["legal_actions"][number];
export type ErrorPayload = Schemas["ErrorPayload"];
export type GameOverPayload = Schemas["GameOverPayload"];
export type Seat = PlayerView["seat"];
export type EndReason = GameOverPayload["reason"];

const SERVER_TYPES: ReadonlySet<string> = new Set<ServerMessage["type"]>([
  "room_state",
  "game_state",
  "events",
  "error",
  "game_over",
  "room_closed",
  "pong",
]);

export type ParsedMessage =
  | { ok: true; message: ServerMessage }
  /** `type` is the frame's type when it had one, for the log. */
  | { ok: false; type: string | null };

/**
 * Reads a frame from the server. Only the envelope is checked (JSON, a known `type`, a `payload`):
 * the payloads follow the server's own typed models.
 */
export function parseServerMessage(data: unknown): ParsedMessage {
  if (typeof data !== "string") return { ok: false, type: null };
  let frame: unknown;
  try {
    frame = JSON.parse(data);
  } catch {
    // Not JSON: the caller logs the dropped frame.
    return { ok: false, type: null };
  }
  if (!isRecord(frame) || typeof frame.type !== "string") return { ok: false, type: null };
  if (!SERVER_TYPES.has(frame.type) || !("payload" in frame)) {
    return { ok: false, type: frame.type };
  }
  return { ok: true, message: frame as ServerMessage };
}
