import { NAME_MAX_LENGTH } from "@/api/bounds";
import type { Origin, OriginBody } from "@/api/hooks/useOrigins";
import type { Catalog, ModuleRef } from "@/catalog/useCatalog";

export interface OriginFormValues {
  name: string;
  color: Origin["color"];
  icon: Origin["icon"];
  field_effects: ModuleRef[];
  background_art_key: string | null;
}

export function emptyOrigin(catalog: Catalog): OriginFormValues {
  return {
    name: "",
    color: catalog.origin_colors[0]?.key ?? "grey",
    icon: catalog.origin_icons[0] ?? "circle",
    field_effects: [],
    background_art_key: null,
  };
}

export function fromOrigin(origin: Origin): OriginFormValues {
  return {
    name: origin.name,
    color: origin.color,
    icon: origin.icon,
    field_effects: origin.field_effects.map((effect) => ({
      key: effect.key,
      params: { ...effect.params },
    })),
    background_art_key: origin.background_art_key,
  };
}

/**
 * A new origin filled in from another one, named "<name> copy". Nothing exists until it is saved.
 * The background key is kept: it was uploaded by the same user, so the server accepts it.
 */
export function duplicateOf(origin: Origin): OriginFormValues {
  return {
    ...fromOrigin(origin),
    name: `${origin.name} copy`.slice(0, NAME_MAX_LENGTH).trim(),
  };
}

/** The whole form as the API takes it, for a create and for a PATCH alike. */
export function toOriginBody(values: OriginFormValues): OriginBody {
  return {
    name: values.name.trim(),
    color: values.color,
    icon: values.icon,
    field_effects: values.field_effects.map((effect) => ({
      key: effect.key,
      params: effect.params ?? {},
    })),
    background_art_key: values.background_art_key,
  };
}
