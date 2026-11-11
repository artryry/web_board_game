/**
 * The app's logger. Every entry is an event name plus fields, the same shape as the server's
 * log lines: `log.warn("api.request_failed", { status: 502, request_id })`. Where the entries go
 * (the console, the server) is up to the sinks that `installLogging` sets.
 */

import { serializeError, type SerializedError } from "./serializeError";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Readonly<Record<string, LogValue>>;

/** A step that came before an error: a page view, an API call, ... */
export interface Breadcrumb {
  ts: string;
  level: LogLevel;
  event: string;
  fields: LogFields;
}

export interface LogEntry extends Breadcrumb {
  /** The page's path, without the query string. */
  page: string;
  error?: SerializedError;
  /** The steps before it, oldest first. Error entries only. */
  breadcrumbs?: readonly Breadcrumb[];
}

export type LogSink = (entry: LogEntry) => void;

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function isAtLeast(level: LogLevel, minimum: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[minimum];
}

export const BREADCRUMB_COUNT = 20;
export const REDACTED = "[redacted]";

// The server's safety net uses the same list (backend app/core/logging_config.py).
const SECRET_KEY_PARTS = [
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "signature",
  "credential",
  "upload_url",
];
const SECRET_KEYS = new Set(["access", "refresh"]);
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]*/g;

function isSecretKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return SECRET_KEYS.has(lowered) || SECRET_KEY_PARTS.some((part) => lowered.includes(part));
}

function redact(fields: LogFields): Record<string, LogValue> {
  const clean: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    clean[key] = isSecretKey(key)
      ? REDACTED
      : typeof value === "string"
        ? value.replace(JWT, REDACTED)
        : value;
  }
  return clean;
}

let sinks: readonly LogSink[] = [];
let recent: Breadcrumb[] = [];

/** Where entries go from now on. `installLogging` sets the real ones; tests set a memory sink. */
export function setLogSinks(next: readonly LogSink[]): void {
  sinks = next;
}

/** Forgets the breadcrumbs (between tests). */
export function resetBreadcrumbs(): void {
  recent = [];
}

function emit(level: LogLevel, event: string, fields: LogFields = {}, error?: unknown): void {
  const crumb: Breadcrumb = { ts: new Date().toISOString(), level, event, fields: redact(fields) };
  const entry: LogEntry = {
    ...crumb,
    page: window.location.pathname,
    ...(error === undefined ? {} : { error: serializeError(error) }),
    ...(level === "error" ? { breadcrumbs: [...recent] } : {}),
  };
  recent = [...recent, crumb].slice(-BREADCRUMB_COUNT);
  for (const sink of sinks) {
    try {
      sink(entry);
    } catch {
      // A broken sink must never break the app; the other sinks still get the entry.
    }
  }
}

export const log = {
  debug: (event: string, fields?: LogFields) => {
    emit("debug", event, fields);
  },
  info: (event: string, fields?: LogFields) => {
    emit("info", event, fields);
  },
  warn: (event: string, fields?: LogFields, error?: unknown) => {
    emit("warn", event, fields, error);
  },
  error: (event: string, fields?: LogFields, error?: unknown) => {
    emit("error", event, fields, error);
  },
};
