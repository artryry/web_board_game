import { createConsoleSink } from "./consoleSink";
import { installWindowErrorHandlers } from "./errorHandlers";
import { setLogSinks, type LogSink } from "./logger";
import { createRemoteSink } from "./remoteSink";

export interface LoggingOptions {
  /** Where the API lives; production builds send warnings and errors to its /api/client-logs. */
  apiOrigin: string;
  /** Adds the user to the server's log line when there is a session. */
  getAccessToken: () => string | null;
}

/**
 * Sets up logging for the page, before the app renders. Dev prints every level to the console;
 * production prints warnings and errors and also sends them to the server.
 */
export function installLogging({ apiOrigin, getAccessToken }: LoggingOptions): void {
  const sinks: LogSink[] = [createConsoleSink(import.meta.env.DEV ? "debug" : "warn")];
  if (import.meta.env.PROD) {
    sinks.push(createRemoteSink({ url: `${apiOrigin}/api/client-logs`, getAccessToken }).sink);
  }
  setLogSinks(sinks);
  installWindowErrorHandlers();
}
