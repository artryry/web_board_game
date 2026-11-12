import type { Card } from "@/api/hooks/useCards";
import type { Origin } from "@/api/hooks/useOrigins";
import type { Catalog } from "@/catalog/useCatalog";
import { CardView } from "@/features/cards/CardView";

interface SharedCardsProps {
  cards: readonly { card: Card; count: number }[];
  /** The origins the cards use: the author's custom ones come with the preview. */
  origins: readonly Origin[];
  catalog: Catalog;
}

/** The cards of a shared deck or group, each with its number of copies. */
export function SharedCards({ cards, origins, catalog }: SharedCardsProps) {
  if (cards.length === 0) return <p className="text-text-muted">No cards.</p>;
  return (
    <ul aria-label="Shared cards" className="flex flex-wrap gap-4">
      {cards.map(({ card, count }) => (
        <li key={card.id} className="flex flex-col items-center gap-1">
          <CardView
            name={card.name}
            manaCost={card.mana_cost}
            content={card}
            artUrl={card.art_url}
            origin={origins.find((origin) => origin.id === card.origin_id)}
            catalog={catalog}
          />
          {count > 1 && (
            <span className="text-sm text-text-muted">
              ×{count} <span className="sr-only">copies</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
