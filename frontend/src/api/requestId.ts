export const REQUEST_ID_HEADER = "X-Request-ID";

/**
 * A new id for one API request. The server keeps it on its log lines and returns it, so a
 * browser error and the server's line for the same request can be matched.
 */
export function newRequestId(): string {
  // randomUUID needs a secure context; plain HTTP on a LAN IP isn't one.
  if (window.isSecureContext) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
