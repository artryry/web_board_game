/** A key as words for the UI: "own_origin" → "Own origin". */
export function humanize(key: string): string {
  const words = key.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
