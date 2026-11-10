import { useFormContext } from "react-hook-form";

import { humanize } from "@/catalog/humanize";
import type { Catalog } from "@/catalog/useCatalog";

import { OriginIcon } from "./OriginIcon";
import type { OriginFormValues } from "./originValues";

// The radio stays in the page for keyboards and screen readers; its label is what shows.
const OPTION =
  "flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 has-[:checked]:border-accent has-[:checked]:bg-surface-raised has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus";

/** An origin's colour and icon, as two radio groups with a name on every choice. */
export function OriginLookFields({ catalog }: { catalog: Catalog }) {
  const { register } = useFormContext<OriginFormValues>();

  return (
    <>
      <fieldset>
        <legend className="text-sm font-medium">Colour</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {catalog.origin_colors.map(({ key, hex }) => (
            <label key={key} className={OPTION}>
              <input type="radio" value={key} className="sr-only" {...register("color")} />
              <span
                aria-hidden="true"
                className="size-5 rounded-full border border-border-strong"
                style={{ backgroundColor: hex }}
              />
              <span className="text-sm">{humanize(key)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium">Icon</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {catalog.origin_icons.map((icon) => (
            <label key={icon} className={OPTION} title={humanize(icon)}>
              <input type="radio" value={icon} className="sr-only" {...register("icon")} />
              <OriginIcon icon={icon} className="size-5" />
              <span className="sr-only">{humanize(icon)}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
