import { useId } from "react";

import { describeParams } from "@/catalog/schemaFields";
import { findModule, type Catalog, type ModuleRef } from "@/catalog/useCatalog";

import { OriginBadge } from "./OriginBadge";
import { originHex } from "./originLook";

interface OriginPreviewProps {
  catalog: Catalog;
  name: string;
  color: string;
  icon: string;
  effects: readonly ModuleRef[];
  backgroundUrl: string | null;
  title?: string;
}

/** The origin as a board section shows it: its background, its look and its field effects. */
export function OriginPreview({
  catalog,
  name,
  color,
  icon,
  effects,
  backgroundUrl,
  title = "Preview",
}: OriginPreviewProps) {
  const hex = originHex(catalog, color);
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className="text-sm font-medium text-text-muted">
        {title}
      </h2>
      <div className="relative aspect-video overflow-hidden rounded-lg border border-border-strong bg-surface">
        {backgroundUrl === null ? (
          <div aria-hidden="true" className="absolute inset-0" style={{ backgroundColor: hex }} />
        ) : (
          <img src={backgroundUrl} alt="" className="absolute inset-0 size-full object-cover" />
        )}
        <div className="absolute top-0 left-0 h-1.5 w-full" style={{ backgroundColor: hex }} />
        <p className="absolute top-3 left-3 max-w-[calc(100%-1.5rem)] rounded-md bg-surface/90 px-2 py-1 font-medium">
          <OriginBadge name={name.trim() || "Unnamed origin"} icon={icon} hex={hex} />
        </p>
      </div>
      {effects.length === 0 ? (
        <p className="text-sm text-text-muted">No field effects.</p>
      ) : (
        <ul aria-label="Field effects" className="flex flex-col gap-2">
          {effects.map((effect, index) => {
            const spec = findModule(catalog.field_effects, effect.key);
            const details =
              spec === undefined ? "" : describeParams(spec.params_schema, effect.params ?? {});
            return (
              // Effects can't repeat, but the key may be briefly empty while one is added.
              <li
                key={`${effect.key}-${index}`}
                className="rounded-md border border-border bg-surface-raised px-3 py-2"
              >
                <p className="text-sm font-medium">{spec?.name ?? effect.key}</p>
                {details !== "" && <p className="text-xs text-text-muted">{details}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
