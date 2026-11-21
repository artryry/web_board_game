import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { endSession, storeAccessToken } from "@/auth/tokens";
import { gameStateMessage, gameView } from "@/test/gameViewFixture";
import { apiError, apiUrl, REFRESHED_ACCESS } from "@/test/handlers";
import { logged } from "@/test/logCapture";
import { closeRoomSocket, isConnected, sendToRoom, sentOfType } from "@/test/roomServer";
import { addRoom, roomStore } from "@/test/roomStore";
import { server } from "@/test/server";

import type { ServerMessage } from "./messages";
import { PING_INTERVAL_MS, RoomSocket, roomSocketUrl, type ConnectionState } from "./socket";

const CODE = "ABC234";

/** A RoomSocket whose states and messages the test can read and wait for. */
function track() {
  const states: string[] = [];
  const messages: ServerMessage[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const socket = new RoomSocket(CODE, {
    onConnection: (state: ConnectionState) => {
      states.push(state.status === "ended" ? `ended:${state.reason}` : state.status);
      notify();
    },
    onMessage: (message) => {
      messages.push(message);
      notify();
    },
  });
  sockets.push(socket);
  /** Resolves once `check` holds: right away, or after a later state or message. */
  const until = (check: () => boolean) =>
    new Promise<void>((resolve) => {
      if (check()) {
        resolve();
        return;
      }
      const listener = () => {
        if (!check()) return;
        listeners.delete(listener);
        resolve();
      };
      listeners.add(listener);
    });
  const last = () => states.at(-1);
  return { socket, states, messages, until, last };
}

const sockets: RoomSocket[] = [];

/** Lets the fake server see what the socket sent: its events run outside the timers. */
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });
}

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

/** Counts `POST /api/auth/refresh`, which the fake answers with `REFRESHED_ACCESS`. */
function countRefreshes(): { count: number } {
  const counter = { count: 0 };
  server.use(
    http.post(apiUrl("/api/auth/refresh"), () => {
      counter.count += 1;
      return HttpResponse.json({ access: REFRESHED_ACCESS });
    }),
  );
  return counter;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  addRoom({ code: CODE });
  storeAccessToken(REFRESHED_ACCESS);
});

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
  vi.useRealTimers();
});

describe("roomSocketUrl", () => {
  it("uses the API's origin with ws for http", () => {
    expect(roomSocketUrl(CODE)).toBe(`ws://${window.location.host}/ws/rooms/${CODE}`);
  });

  it("uses wss for https", () => {
    vi.stubEnv("VITE_API_ORIGIN", "https://api.example.com");
    try {
      expect(roomSocketUrl(CODE)).toBe(`wss://api.example.com/ws/rooms/${CODE}`);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("RoomSocket", () => {
  it("sends auth first, opens on the first room_state, and numbers every message", async () => {
    const { socket, states, messages, until } = track();
    socket.connect();
    await until(() => states.includes("open"));

    expect(states).toEqual(["connecting", "open"]);
    expect(messages[0]?.type).toBe("room_state");
    expect(roomStore.sent[0]).toEqual({
      type: "auth",
      seq: 1,
      payload: { token: REFRESHED_ACCESS },
    });
    expect(logged("ws.connected")[0]?.fields).toEqual({ room_code: CODE });

    expect(socket.send({ type: "ready", payload: { ready: false } })).toBe(2);
    expect(socket.send({ type: "ready", payload: { ready: false } })).toBe(3);
    await settle();
    expect(sentOfType("ready").map((message) => message.seq)).toEqual([2, 3]);
  });

  it("never puts the token in a log entry", async () => {
    const { socket, until, states } = track();
    socket.connect();
    await until(() => states.includes("open"));
    closeRoomSocket(CODE, 1011);
    await until(() => states.at(-1) === "reconnecting");
    expect(JSON.stringify(logged("ws.closed"))).not.toContain(REFRESHED_ACCESS);
  });

  it("pings every 30 s while open", async () => {
    const { socket, states, until } = track();
    socket.connect();
    await until(() => states.includes("open"));

    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS - 1);
    await settle();
    expect(sentOfType("ping")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(sentOfType("ping")).toEqual([{ type: "ping", seq: 2, payload: {} }]);
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    await settle();
    expect(sentOfType("ping")).toHaveLength(2);
  });

  it("returns null and sends nothing while it isn't open", () => {
    const { socket } = track();
    expect(socket.send({ type: "ready", payload: { ready: true } })).toBeNull();
  });

  it("reconnects with backoff, keeps counting seq, and resets the backoff once back", async () => {
    const { socket, states, until } = track();
    const reconnects = () => logged("ws.reconnecting").map((entry) => entry.fields.delay_ms);
    socket.connect();
    await until(() => states.includes("open"));

    // Every attempt but the last fails before it gets the room.
    roomStore.refusals = [1011, 1011, 1011, 1011, 1011];
    closeRoomSocket(CODE, 1011);
    await until(() => reconnects().length === 1);
    expect(states.at(-1)).toBe("reconnecting");
    expect(logged("ws.reconnecting")[0]?.fields).toEqual({
      attempt: 1,
      delay_ms: 1000,
      code: 1011,
    });

    // Each refused attempt schedules the next, after the next delay.
    for (const [index, delay] of [1000, 2000, 4000, 8000, 15000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(sentOfType("auth")).toHaveLength(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      await until(() => reconnects().length === index + 2);
    }
    expect(reconnects()).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
    await vi.advanceTimersByTimeAsync(15000);
    await until(() => states.at(-1) === "open");

    // The auths carried seq 1 to 7: it counts across reconnects.
    expect(sentOfType("auth").map((message) => message.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    closeRoomSocket(CODE, 1006);
    await until(() => reconnects().length === 7);
    expect(reconnects().at(-1)).toBe(1000);
  });

  it("refreshes the token first when there is none", async () => {
    const refreshes = countRefreshes();
    endSession("logout");
    const { socket, states, until } = track();
    socket.connect();
    await until(() => states.includes("open"));
    expect(refreshes.count).toBe(1);
    expect(sentOfType("auth")[0]?.payload.token).toBe(REFRESHED_ACCESS);
  });

  it("refreshes the token first when it expires within 30 s", async () => {
    const refreshes = countRefreshes();
    storeAccessToken(jwt({ sub: "alice", exp: Math.floor(Date.now() / 1000) + 10 }));
    const { socket, states, until } = track();
    socket.connect();
    await until(() => states.includes("open"));
    expect(refreshes.count).toBe(1);
    expect(sentOfType("auth")[0]?.payload.token).toBe(REFRESHED_ACCESS);
  });

  it("on 4401 refreshes and reconnects at once", async () => {
    const refreshes = countRefreshes();
    // A token that's still good by its exp, which the server refuses anyway.
    storeAccessToken(jwt({ sub: "alice", exp: Math.floor(Date.now() / 1000) + 600 }));
    const { socket, states, until } = track();
    socket.connect();
    await until(() => states.includes("open"));

    expect(refreshes.count).toBe(1);
    expect(states).toEqual(["connecting", "reconnecting", "open"]);
    expect(sentOfType("auth").map((message) => message.payload.token)).toEqual([
      expect.stringContaining("."),
      REFRESHED_ACCESS,
    ]);
    expect(logged("ws.reconnecting")).toHaveLength(0);
  });

  it("ends with auth_failed on a second 4401 in a row", async () => {
    roomStore.refusals = [4401, 4401];
    const { socket, states, until } = track();
    socket.connect();
    await until(() => states.at(-1) === "ended:auth_failed");
    expect(sentOfType("auth")).toHaveLength(2);

    // Try again starts over.
    socket.reconnect();
    await until(() => states.at(-1) === "open");
  });

  it("stops when the session has ended", async () => {
    server.use(http.post(apiUrl("/api/auth/refresh"), () => apiError(401, "refresh_invalid")));
    endSession("logout");
    const { socket, states } = track();
    socket.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(states).toEqual(["connecting"]);
    expect(sentOfType("auth")).toHaveLength(0);
  });

  it.each([
    [4403, "not_member"],
    [4404, "room_gone"],
    [4409, "replaced"],
  ])("ends on %i without reconnecting", async (code, reason) => {
    const { socket, states, until } = track();
    socket.connect();
    await until(() => states.includes("open"));
    closeRoomSocket(CODE, code);
    await until(() => states.at(-1) === `ended:${reason}`);

    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(sentOfType("auth")).toHaveLength(1);
    expect(logged("ws.closed").at(-1)?.fields).toEqual({ code, room_code: CODE });
  });

  it("Use it here connects again after 4409", async () => {
    const { socket, states, until } = track();
    socket.connect();
    await until(() => states.includes("open"));
    closeRoomSocket(CODE, 4409);
    await until(() => states.at(-1) === "ended:replaced");
    socket.reconnect();
    await until(() => states.at(-1) === "open");
    expect(isConnected(CODE)).toBe(true);
  });

  it("ends as room_closed on the 1000 after room_closed", async () => {
    const { socket, states, messages, until } = track();
    socket.connect();
    await until(() => states.includes("open"));
    sendToRoom(CODE, { type: "room_closed", payload: null });
    closeRoomSocket(CODE, 1000);
    await until(() => states.at(-1) === "ended:room_closed");
    expect(messages.at(-1)?.type).toBe("room_closed");
  });

  it("reconnects on a 1000 that no room_closed or leave explains", async () => {
    const { socket, states, until } = track();
    socket.connect();
    await until(() => states.includes("open"));
    closeRoomSocket(CODE, 1000);
    await until(() => states.at(-1) === "reconnecting");
  });

  it("ends as left after the player's own leave, for the host too", async () => {
    const { socket, states, until } = track();
    socket.connect();
    await until(() => states.includes("open"));
    // Alice hosts: the server sends room_closed, then 1000. Her own leave wins.
    expect(socket.leave()).toBe(2);
    await until(() => states.at(-1) === "ended:left");
    expect(sentOfType("leave")).toEqual([{ type: "leave", seq: 2, payload: {} }]);
  });

  it("drops a game_state older than the newest one", async () => {
    const { socket, states, messages, until } = track();
    socket.connect();
    await until(() => states.includes("open"));
    sendToRoom(CODE, gameStateMessage(gameView({ version: 2 })));
    sendToRoom(CODE, gameStateMessage(gameView({ version: 1 })));
    sendToRoom(CODE, { type: "pong", payload: null });
    sendToRoom(CODE, gameStateMessage(gameView({ version: 3 })));
    await until(() => messages.filter((message) => message.type === "game_state").length === 2);

    const versions = messages.flatMap((message) =>
      message.type === "game_state" ? [message.payload.view.version] : [],
    );
    expect(versions).toEqual([2, 3]);
    expect(logged("game.stale_state_dropped")[0]?.fields).toEqual({ version: 1, current: 2 });
    expect(messages.some((message) => message.type === "pong")).toBe(false);
  });

  it("drops and logs frames that don't parse or have an unknown type", async () => {
    const { socket, states, messages, until } = track();
    socket.connect();
    await until(() => states.includes("open"));
    sendToRoom(CODE, "not json");
    sendToRoom(CODE, JSON.stringify({ type: "surprise", payload: null }));
    sendToRoom(CODE, { type: "game_over", payload: { winner: null, reason: "out_of_cards" } });
    await until(() => messages.some((message) => message.type === "game_over"));

    expect(logged("ws.bad_server_message").map((entry) => [entry.level, entry.fields])).toEqual([
      ["warn", { type: null }],
      ["warn", { type: "surprise" }],
    ]);
  });

  it("passes a server error on and logs it at info", async () => {
    const { socket, states, messages, until } = track();
    socket.connect();
    await until(() => states.includes("open"));
    const seq = socket.send({ type: "ready", payload: { ready: true } });
    await until(() => messages.some((message) => message.type === "error"));
    expect(logged("ws.server_error").map((entry) => [entry.level, entry.fields])).toEqual([
      ["info", { reason: "no_deck", seq }],
    ]);
  });

  it("close() stops for good: no reconnect and no more callbacks", async () => {
    const { socket, states, until } = track();
    socket.connect();
    await until(() => states.includes("open"));
    socket.close();
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(states).toEqual(["connecting", "open"]);
    expect(sentOfType("auth")).toHaveLength(1);
    expect(sentOfType("ping")).toHaveLength(0);
  });
});
