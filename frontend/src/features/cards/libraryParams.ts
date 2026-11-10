import { isRecord } from "@/api/errors";
import { UNGROUPED, type CardFilters } from "@/api/hooks/useCards";

// The card library keeps its view in the query string, so it survives a reload and can be linked
// to (F2's import goes to `/cards?group=<id>`): `group` (an id or `ungrouped`), `origin`, `kind`.

export type LibraryParam = "group" | "origin" | "kind";

export function libraryFilters(params: URLSearchParams): CardFilters {
  const kind = params.get("kind");
  return {
    group: nonEmpty(params.get("group")),
    originId: nonEmpty(params.get("origin")),
    kind: kind === "creature" || kind === "spell" ? kind : undefined,
  };
}

/** The library's query string with some values changed; null removes one. */
export function librarySearch(
  params: URLSearchParams,
  changes: Partial<Record<LibraryParam, string | null>>,
): string {
  const next = new URLSearchParams(params);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null || value === "") next.delete(name);
    else next.set(name, value);
  }
  const query = next.toString();
  return query === "" ? "" : `?${query}`;
}

/** `/cards/new`, starting in the group and origin the library is showing. */
export function newCardPath(filters: CardFilters): string {
  const starts = new URLSearchParams();
  if (filters.group !== undefined && filters.group !== UNGROUPED)
    starts.set("group", filters.group);
  if (filters.originId !== undefined) starts.set("origin", filters.originId);
  const query = starts.toString();
  return query === "" ? "/cards/new" : `/cards/new?${query}`;
}

/** Where the card editor goes back to: the library view it was opened from, with its filters. */
export function libraryReturnPath(state: unknown): string {
  const from = isRecord(state) ? state.from : undefined;
  return typeof from === "string" && from.startsWith("/cards") ? from : "/cards";
}

function nonEmpty(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}
