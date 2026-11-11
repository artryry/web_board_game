import type { components } from "@/api/schema";

import { isAtLeast, log, type LogEntry, type LogFields, type LogSink } from "./logger";

type WireEntry = components["schemas"]["ClientLogEntry"];
type WireContext = WireEntry["context"];

export const BATCH_SIZE = 10;
// Under the server's 64 KiB cap, which keepalive requests can't exceed either.
export const MAX_BATCH_BYTES = 48 * 1024;
export const MAX_QUEUE = 50;
export const REPEAT_WINDOW_MS = 60_000;
// A token bucket: 10 entries at once, then 20 more per 5 minutes (one per 15 s).
export const BUCKET_SIZE = 10;
export const REFILL_MS = 15_000;
const FLUSH_INTERVAL_MS = 5_000;

// The server's limits (backend app/schemas/client_log.py).
const EVENT = /^[a-z0-9_.]{1,64}$/;
const CONTEXT_KEY = /^[a-z0-9_]{1,40}$/;
const CONTEXT_KEYS = 20;
const BREADCRUMB_KEYS = 5;
const TEXT_LENGTH = 200;
const MESSAGE_LENGTH = 500;
const STACK_LENGTH = 4000;

export interface RemoteSinkOptions {
  url: string;
  getAccessToken: () => string | null;
  /** The clock, for tests. */
  now?: () => number;
}

export interface RemoteSink {
  sink: LogSink;
  /** Sends one batch now. `keepalive` lets it outlive the page (on `pagehide`). */
  flush: (keepalive?: boolean) => Promise<void>;
  stop: () => void;
}

/**
 * Sends warnings and errors to `POST /api/client-logs` in batches, so they show up in the
 * server's log. Repeats and floods are held back here, and its own failures are never sent.
 */
export function createRemoteSink({
  url,
  getAccessToken,
  now = Date.now,
}: RemoteSinkOptions): RemoteSink {
  let queue: WireEntry[] = [];
  let tokens = BUCKET_SIZE;
  let refilledAt = now();
  let dropped = 0;
  // Sends go one after another; each takes its batch when its turn comes.
  let inFlight: Promise<void> = Promise.resolve();
  const seen = new Map<string, { since: number; repeats: number }>();

  function takeToken(): boolean {
    const time = now();
    tokens = Math.min(BUCKET_SIZE, tokens + (time - refilledAt) / REFILL_MS);
    refilledAt = time;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  }

  /** How often it was held back as a repeat since it was last sent, or null to hold it back. */
  function repeatsBefore(entry: LogEntry): number | null {
    const key = `${entry.event}|${entry.error?.message ?? ""}`;
    const time = now();
    const last = seen.get(key);
    if (last !== undefined && time - last.since < REPEAT_WINDOW_MS) {
      last.repeats += 1;
      return null;
    }
    if (seen.size > MAX_QUEUE) seen.clear();
    seen.set(key, { since: time, repeats: 0 });
    return last?.repeats ?? 0;
  }

  const sink: LogSink = (entry) => {
    if (!isAtLeast(entry.level, "warn") || !EVENT.test(entry.event)) return;
    const repeats = repeatsBefore(entry);
    if (repeats === null) return;
    if (queue.length >= MAX_QUEUE || !takeToken()) {
      dropped += 1;
      return;
    }
    const counts = { ...(repeats > 0 ? { repeats } : {}), ...(dropped > 0 ? { dropped } : {}) };
    queue.push(toWire(entry, counts));
    dropped = 0;
    if (queue.length >= BATCH_SIZE) void flush();
  };

  function takeBatch(): WireEntry[] {
    const batch: WireEntry[] = [];
    let bytes = byteLength('{"entries":[]}');
    while (batch.length < BATCH_SIZE) {
      const next = queue[0];
      if (next === undefined) break;
      const size = byteLength(JSON.stringify(next)) + 1;
      if (size + bytes > MAX_BATCH_BYTES) {
        if (batch.length > 0) break;
        queue = queue.slice(1); // too big even alone
        continue;
      }
      batch.push(next);
      queue = queue.slice(1);
      bytes += size;
    }
    return batch;
  }

  function flush(keepalive = false): Promise<void> {
    // When the page goes away there is no time to wait for the send in flight.
    if (keepalive) return send(true);
    inFlight = inFlight.then(() => send(false));
    return inFlight;
  }

  async function send(keepalive: boolean): Promise<void> {
    const entries = takeBatch();
    if (entries.length === 0) return;
    const token = getAccessToken();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ entries }),
        keepalive,
      });
      if (!response.ok) log.debug("log.send_failed", { status: response.status });
    } catch {
      // The entries are lost; debug lines never come back here, so this can't loop.
      log.debug("log.send_failed", { network: true });
    }
  }

  const timer = window.setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  const onPageHide = () => void flush(true);
  const onVisibility = () => {
    if (document.visibilityState === "hidden") void flush(true);
  };
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibility);

  return {
    sink,
    flush,
    stop: () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

function toWire(entry: LogEntry, counts: LogFields): WireEntry {
  const isError = entry.level === "error";
  return {
    level: isError ? "error" : "warn",
    event: entry.event,
    message: (entry.error?.message ?? "").slice(0, MESSAGE_LENGTH),
    stack: entry.error?.stack?.slice(0, STACK_LENGTH) ?? null,
    page: entry.page.slice(0, TEXT_LENGTH),
    client_ts: entry.ts,
    context: toContext({ ...entry.fields, ...counts }, CONTEXT_KEYS),
    breadcrumbs: isError
      ? (entry.breadcrumbs ?? [])
          .filter((crumb) => EVENT.test(crumb.event))
          .map((crumb) => ({
            ts: crumb.ts,
            level: crumb.level,
            event: crumb.event,
            context: toContext(crumb.fields, BREADCRUMB_KEYS),
          }))
      : [],
  };
}

/** The fields the server accepts: flat values under snake_case keys, within its limits. */
function toContext(fields: LogFields, maxKeys: number): WireContext {
  const context: WireContext = {};
  for (const [key, value] of Object.entries(fields)) {
    if (Object.keys(context).length >= maxKeys) break;
    if (value === undefined || !CONTEXT_KEY.test(key)) continue;
    context[key] = typeof value === "string" ? value.slice(0, TEXT_LENGTH) : value;
  }
  return context;
}

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).length;
}
