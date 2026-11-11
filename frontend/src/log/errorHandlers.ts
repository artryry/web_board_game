import type { RootOptions } from "react-dom/client";
import type { ClientOnErrorFunction } from "react-router";

import { log, type LogFields, type LogLevel } from "./logger";
import { isErrorLike } from "./serializeError";

// One error can reach several hooks: React's onCaughtError, then the router's onError. The first
// one logs it.
const logged = new WeakSet<object>();

function logOnce(level: LogLevel, event: string, error: unknown, fields: LogFields = {}): void {
  if (typeof error === "object" && error !== null) {
    if (logged.has(error)) return;
    logged.add(error);
  }
  if (level === "error") log.error(event, fields, error);
  else log.warn(event, fields, error);
}

/** A cancelled request (the page moved on): not a failure. */
export function isAbort(error: unknown): boolean {
  return isErrorLike(error) && error.name === "AbortError";
}

function fromExtension(filename: string): boolean {
  return /^(chrome|moz|safari(-web)?)-extension:/.test(filename);
}

/**
 * Logs errors nothing else caught: `error` events (in the bubble phase, so a broken image, whose
 * error doesn't bubble, isn't one) and promise rejections nobody handled.
 */
export function installWindowErrorHandlers(): () => void {
  const onError = (event: ErrorEvent) => {
    // "Script error." comes from another origin's script and carries nothing useful.
    const error: unknown = event.error;
    if (error == null && (event.message === "" || event.message === "Script error.")) return;
    if (fromExtension(event.filename)) return;
    logOnce("error", "window.error", error ?? event.message, {
      source: event.filename.replace(window.location.origin, ""),
      line: event.lineno,
      column: event.colno,
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    if (isAbort(reason)) return;
    logOnce("error", "window.unhandled_rejection", reason);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

/** React's root error hooks. Passing them also stops React's own console output. */
export const rootErrorOptions = {
  onCaughtError: (error, info) => {
    logOnce("error", "ui.render_error", error, { component_stack: info.componentStack });
  },
  onUncaughtError: (error, info) => {
    logOnce("error", "ui.uncaught_error", error, { component_stack: info.componentStack });
  },
  onRecoverableError: (error, info) => {
    logOnce("warn", "ui.recoverable_error", error, { component_stack: info.componentStack });
  },
} satisfies RootOptions;

/** The router's error hook, for errors its error boundary shows (RouteErrorPage). */
export const onRouterError: ClientOnErrorFunction = (error, info) => {
  logOnce("error", "ui.render_error", error, {
    route: info.pattern,
    component_stack: info.errorInfo?.componentStack,
  });
};
