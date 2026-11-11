// The one file allowed to call `console` (eslint.config.js).
import { isAtLeast, type LogLevel, type LogSink } from "./logger";

/** Prints entries from `minimum` up: every level in dev, warnings and errors in production. */
export function createConsoleSink(minimum: LogLevel): LogSink {
  return (entry) => {
    if (!isAtLeast(entry.level, minimum)) return;
    const details = {
      ...entry.fields,
      ...(entry.error === undefined ? {} : { error: entry.error }),
    };
    console[entry.level](entry.event, details);
  };
}
