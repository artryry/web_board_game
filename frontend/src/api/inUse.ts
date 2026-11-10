import { ApiError, isRecord } from "./errors";

export interface InUseItem {
  id: string;
  name: string;
}

/**
 * The `{id, name}` list that a 409 (`origin_in_use`, `card_in_use`) carries under `key`, or an
 * empty list for any other error.
 */
export function inUseItems(error: unknown, key: "cards" | "decks"): InUseItem[] {
  if (!(error instanceof ApiError)) return [];
  const list = error.extra[key];
  if (!Array.isArray(list)) return [];
  const items: unknown[] = list;
  return items.filter(
    (item): item is InUseItem =>
      isRecord(item) && typeof item.id === "string" && typeof item.name === "string",
  );
}
