import type { Card } from "@/api/hooks/useCards";
import type { Origin } from "@/api/hooks/useOrigins";
import type { Catalog } from "@/catalog/useCatalog";
import { Button } from "@/ui/Button";
import { ButtonLink } from "@/ui/ButtonLink";

import { BalanceLabel } from "./BalanceLabel";
import { CardView } from "./CardView";

interface LibraryCardProps {
  card: Card;
  origin: Origin | undefined;
  catalog: Catalog;
  /** The library view, so the editor can come back to it. */
  from: string;
  onMove: (card: Card) => void;
}

/** One card in the library grid, with its balance label, Edit and Move to group. */
export function LibraryCard({ card, origin, catalog, from, onMove }: LibraryCardProps) {
  return (
    <li className="flex w-44 flex-col gap-2">
      <CardView
        name={card.name}
        manaCost={card.mana_cost}
        content={card}
        artUrl={card.art_url}
        origin={origin}
        catalog={catalog}
      />
      <BalanceLabel balance={card.balance} suggested={card.suggested_mana_cost} />
      <div className="flex gap-2">
        <ButtonLink
          variant="secondary"
          to={`/cards/${card.id}`}
          state={{ from }}
          className="flex-1 px-2 py-1 text-sm"
        >
          Edit <span className="sr-only">{card.name}</span>
        </ButtonLink>
        <Button
          variant="secondary"
          className="flex-1 px-2 py-1 text-sm"
          onClick={() => {
            onMove(card);
          }}
        >
          Move… <span className="sr-only">{card.name} to a group</span>
        </Button>
      </div>
    </li>
  );
}
