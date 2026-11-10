// The API's largest page (backend/app/schemas/common.py MAX_PAGE_LIMIT).
const PAGE_LIMIT = 100;

interface Page<T> {
  items: T[];
  total: number;
}

/**
 * Loads every page of a short list, such as origins or card groups, until it has `total` items.
 * An empty page stops it too, in case rows were deleted while it loaded.
 */
export async function fetchAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>,
): Promise<T[]> {
  const items: T[] = [];
  for (;;) {
    const page = await fetchPage(items.length, PAGE_LIMIT);
    items.push(...page.items);
    if (page.items.length === 0 || items.length >= page.total) return items;
  }
}
