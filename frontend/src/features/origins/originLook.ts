import type { Catalog } from "@/catalog/useCatalog";

// The palette's grey, for a colour key from a newer backend that the catalog in hand lacks.
const FALLBACK_HEX = "#999999";

/** The hex value of an origin colour key, from the catalog's palette. */
export function originHex(catalog: Catalog, color: string): string {
  return catalog.origin_colors.find((entry) => entry.key === color)?.hex ?? FALLBACK_HEX;
}
