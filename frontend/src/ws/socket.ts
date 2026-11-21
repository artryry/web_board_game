import { apiOrigin, refreshSession } from "@/api/client";
import { getAccessToken } from "@/auth/tokens";
import { tokenExpiresAt } from "@/auth/tokenExpiry";
import { log } from "@/log/logger";

import { parseServerMessage, type OutgoingMessage, type ServerMessage } from "./messages";

// The client side of the game socket (backend_plan §9.2, frontend_plan §6): `auth` first, `seq`
// on every message, a ping, the close codes, and reconnects with backoff. It knows no React: the
// room page drives it through ws/gameStore.ts.

/** How long a player may be away from a running game before they lose (backend `disconnect_forfeit_s`). */
export const DISCONNECT_FORFEIT_MS = 60_000;
/** Keeps idle proxies from closing the socket (the server answers `pong`). */
export const PING_INTERVAL_MS = 30_000;
/** The waits before each reconnect; the last one repeats. */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
/** A token this close to its expiry is renewed before connecting. */
const TOKEN_MARGIN_MS = 30_000;

/** The server's close codes (backend app/schemas/room.py). */
export const CLOSE_CODES = {
  normal: 1000,
  authFailed: 4401,
  notMember: 4403,
  noRoom: 4404,
  replaced: 4409,
} as const;

/** Why the connection ended for good. Each has its own message on the room page. */
export type EndReason =
  "not_member" | "room_gone" | "replaced" | "room_closed" | "left" | "auth_failed";

export type ConnectionState =
  | { status: "connecting" }
  /** The server took `auth` and sent the room. */
  | { status: "open" }
  | { status: "reconnecting" }
  | { status: "ended"; reason: EndReason };

export interface RoomSocketHandlers {
  onMessage: (message: ServerMessage) => void;
  onConnection: (state: ConnectionState) => void;
}

/** The socket's URL: the API's origin with `ws` for `http` (so `wss` for `https`). */
export function roomSocketUrl(code: string): string {
  return `${apiOrigin().replace(/^http/, "ws")}/ws/rooms/${code}`;
}

const ENDING_CODES: Readonly<Record<number, EndReason>> = {
  [CLOSE_CODES.notMember]: "not_member",
  [CLOSE_CODES.noRoom]: "room_gone",
  [CLOSE_CODES.replaced]: "replaced",
};

export class RoomSocket {
  private readonly code: string;
  private readonly handlers: RoomSocketHandlers;
  private socket: WebSocket | null = null;
  /** The last `seq` sent. It counts for the life of this object, across reconnects. */
  private seq = 0;
  /** Reconnects since the last connection that got its room. */
  private attempt = 0;
  /** The connection got its first `room_state`: the server took `auth`. */
  private hasRoom = false;
  /** The last close was a 4401, with no room since: a second one in a row ends. */
  private authFailedOnce = false;
  private roomClosed = false;
  private leaving = false;
  private stopped = false;
  /** The newest game view's version. An older `game_state` is dropped. */
  private version = -1;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string, handlers: RoomSocketHandlers) {
    this.code = code;
    this.handlers = handlers;
  }

  connect(): void {
    this.stopped = false;
    this.handlers.onConnection({ status: "connecting" });
    void this.open(false);
  }

  /** Connects again after the connection ended: "Use it here" (4409) or "Try again" (4401). */
  reconnect(): void {
    this.attempt = 0;
    this.authFailedOnce = false;
    this.connect();
  }

  /**
   * Sends a message with the next `seq`, which it returns. Nothing is queued: while the socket
   * isn't open the room page disables its controls, and this returns null.
   */
  send(message: OutgoingMessage): number | null {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.hasRoom) return null;
    this.seq += 1;
    this.socket.send(JSON.stringify({ ...message, seq: this.seq }));
    return this.seq;
  }

  /** Leaves the room. The server's close that follows ends the connection as `left`. */
  leave(): number | null {
    const seq = this.send({ type: "leave", payload: {} });
    if (seq !== null) this.leaving = true;
    return seq;
  }

  /** Closes for good (the room page unmounts): no reconnect, no more callbacks. */
  close(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close(CLOSE_CODES.normal);
  }

  private async open(forceRefresh: boolean): Promise<void> {
    let token = getAccessToken();
    if (forceRefresh || token === null || expiresSoon(token)) {
      let renewed: boolean;
      try {
        renewed = await refreshSession();
      } catch {
        // A network error keeps the session: try again later, like a dropped connection.
        if (!this.stopped) this.retryLater(null);
        return;
      }
      // An ended session sends the app to the login page, which unmounts the room page.
      if (!renewed) this.stopped = true;
      token = getAccessToken();
    }
    if (this.stopped || token === null) return;

    const socket = new WebSocket(roomSocketUrl(this.code));
    this.socket = socket;
    this.hasRoom = false;
    socket.onopen = () => {
      this.seq += 1;
      socket.send(JSON.stringify({ type: "auth", seq: this.seq, payload: { token } }));
      this.startPing();
    };
    socket.onmessage = (event) => {
      if (socket === this.socket) this.receive(event.data);
    };
    socket.onclose = (event) => {
      if (socket === this.socket) this.closed(event.code);
    };
  }

  private receive(data: unknown): void {
    const parsed = parseServerMessage(data);
    if (!parsed.ok) {
      log.warn("ws.bad_server_message", { type: parsed.type });
      return;
    }
    const message = parsed.message;
    switch (message.type) {
      case "room_state":
        if (!this.hasRoom) this.opened();
        break;
      case "game_state": {
        const version = message.payload.view.version;
        if (version < this.version) {
          log.debug("game.stale_state_dropped", { version, current: this.version });
          return;
        }
        this.version = version;
        break;
      }
      case "error":
        // An expected refusal, like a 4xx: the page shows it.
        log.info("ws.server_error", {
          reason: message.payload.reason,
          seq: message.payload.seq,
        });
        break;
      case "room_closed":
        this.roomClosed = true;
        break;
      case "pong":
        return;
      default:
        break;
    }
    this.handlers.onMessage(message);
  }

  private opened(): void {
    this.hasRoom = true;
    this.attempt = 0;
    this.authFailedOnce = false;
    log.debug("ws.connected", { room_code: this.code });
    this.handlers.onConnection({ status: "open" });
  }

  private closed(code: number): void {
    this.socket = null;
    this.clearTimers();
    log.info("ws.closed", { code, room_code: this.code });

    if (this.leaving) {
      this.end("left");
      return;
    }
    if (code === CLOSE_CODES.normal && this.roomClosed) {
      this.end("room_closed");
      return;
    }
    const ending = ENDING_CODES[code];
    if (ending !== undefined) {
      this.end(ending);
      return;
    }
    if (code === CLOSE_CODES.authFailed) {
      if (this.authFailedOnce) {
        this.end("auth_failed");
        return;
      }
      // The token may have expired: renew it and try once more, at once.
      this.authFailedOnce = true;
      this.handlers.onConnection({ status: "reconnecting" });
      void this.open(true);
      return;
    }
    this.authFailedOnce = false;
    this.retryLater(code);
  }

  private retryLater(code: number | null): void {
    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)] ??
      RECONNECT_DELAYS_MS[0];
    this.attempt += 1;
    log.info("ws.reconnecting", { attempt: this.attempt, delay_ms: delay, code });
    this.handlers.onConnection({ status: "reconnecting" });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.open(false);
    }, delay);
  }

  private end(reason: EndReason): void {
    this.stopped = true;
    this.clearTimers();
    this.handlers.onConnection({ status: "ended", reason });
  }

  private startPing(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping", payload: {} });
    }, PING_INTERVAL_MS);
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.pingTimer = null;
    this.retryTimer = null;
  }
}

function expiresSoon(token: string): boolean {
  const expiresAt = tokenExpiresAt(token);
  return expiresAt !== null && expiresAt - Date.now() < TOKEN_MARGIN_MS;
}
