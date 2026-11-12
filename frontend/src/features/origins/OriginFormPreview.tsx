import { useWatch } from "react-hook-form";

import type { Catalog } from "@/catalog/useCatalog";

import { OriginPreview } from "./OriginPreview";
import type { OriginFormValues } from "./originValues";

/** The origin editor's live preview: the preview of the form's current values. */
export function OriginFormPreview({
  catalog,
  backgroundUrl,
}: {
  catalog: Catalog;
  backgroundUrl: string | null;
}) {
  const [name, color, icon, effects] = useWatch<
    OriginFormValues,
    ["name", "color", "icon", "field_effects"]
  >({ name: ["name", "color", "icon", "field_effects"] });
  return (
    <OriginPreview
      catalog={catalog}
      name={name}
      color={color}
      icon={icon}
      effects={effects}
      backgroundUrl={backgroundUrl}
    />
  );
}
