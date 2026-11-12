/** The import page's address for a share code, on this site. */
export function shareLink(code: string): string {
  return `${window.location.origin}/share/${code}`;
}

/** A typed or pasted code as the server reads it: no spaces, upper case. */
export function normalizeShareCode(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}
