import { resetBreadcrumbs, setLogSinks, type LogEntry } from "@/log/logger";

/** Every log entry of the current test, in order. Nothing reaches the console. */
export const logEntries: LogEntry[] = [];

/** Sends the logger's entries to `logEntries`, empty and with no breadcrumbs (setup.ts). */
export function captureLogs(): void {
  logEntries.length = 0;
  resetBreadcrumbs();
  setLogSinks([(entry) => logEntries.push(entry)]);
}

/** The entries with this event name. */
export function logged(event: string): LogEntry[] {
  return logEntries.filter((entry) => entry.event === event);
}
