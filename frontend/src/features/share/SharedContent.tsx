import type { Origin } from "@/api/hooks/useOrigins";
import type { SharePreview } from "@/api/hooks/useShare";
import type { Catalog } from "@/catalog/useCatalog";
import { ManaCurveChart } from "@/features/decks/ManaCurveChart";
import { OriginBadge } from "@/features/origins/OriginBadge";
import { originHex } from "@/features/origins/originLook";
import { OriginPreview } from "@/features/origins/OriginPreview";

import { SharedCards } from "./SharedCards";

interface SharedContentProps {
  shared: Exclude<SharePreview, { kind: "ruleset" }>;
  catalog: Catalog;
  /** The viewer's origins: they include the system ones, such as Neutral. */
  systemOrigins: readonly Origin[];
}

/** A shared deck or group: its cards, and its origin and mana curve, or its origins. */
export function SharedContent({ shared, catalog, systemOrigins }: SharedContentProps) {
  const shownOrigins = shared.kind === "deck" ? [shared.origin] : shared.origins;
  const origins = [...shownOrigins, ...systemOrigins];
  const cardsTitle = `Cards · ${shared.card_count}`;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="shared-cards-title" className="flex min-w-0 flex-col gap-4">
        <h2 id="shared-cards-title" className="text-lg font-semibold">
          {cardsTitle}
        </h2>
        <SharedCards cards={shared.cards} origins={origins} catalog={catalog} />
      </section>
      <div className="flex flex-col gap-6">
        {shared.kind === "deck" ? (
          <>
            <OriginPreview
              title="Origin"
              catalog={catalog}
              name={shared.origin.name}
              color={shared.origin.color}
              icon={shared.origin.icon}
              effects={shared.origin.field_effects}
              backgroundUrl={shared.origin.background_art_url}
            />
            <ManaCurveChart entries={shared.cards} />
          </>
        ) : (
          <section aria-labelledby="shared-origins-title" className="flex flex-col gap-2">
            <h2 id="shared-origins-title" className="text-sm font-medium text-text-muted">
              Origins
            </h2>
            <ul className="flex flex-col gap-1">
              {shared.origins.map((origin) => (
                <li key={origin.id}>
                  <OriginBadge
                    name={origin.name}
                    icon={origin.icon}
                    hex={originHex(catalog, origin.color)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
