import { useState } from "react";

import type { Card, CardKind } from "@/api/hooks/useCards";
import { NEUTRAL_KEY, type Origin } from "@/api/hooks/useOrigins";
import type { Catalog } from "@/catalog/useCatalog";
import { LoadingState } from "@/ui/LoadingState";
import { SelectField } from "@/ui/SelectField";
import { TextField } from "@/ui/TextField";

import { canAdd, copiesOf, type DeckEntry } from "./deckEntries";
import { LibraryCardButton } from "./LibraryCardButton";

interface DeckLibraryPanelProps {
  /** The deck's origin, or "" before one is picked. */
  originId: string;
  /** The cards the deck can hold, or undefined while they load. */
  cards: readonly Card[] | undefined;
  error: Error | null;
  entries: readonly DeckEntry[];
  origins: readonly Origin[];
  catalog: Catalog;
  onAdd: (card: Card) => void;
}

/** The cards that fit the deck, with a kind filter and a name search. */
export function DeckLibraryPanel({
  originId,
  cards,
  error,
  entries,
  origins,
  catalog,
  onAdd,
}: DeckLibraryPanelProps) {
  const [kind, setKind] = useState<CardKind | "">("");
  const [search, setSearch] = useState("");
  const origin = origins.find((candidate) => candidate.id === originId);

  let body;
  if (originId === "") {
    body = <p className="text-text-muted">Pick an origin to see its cards.</p>;
  } else if (cards === undefined) {
    body = <LoadingState error={error} />;
  } else {
    const needle = search.trim().toLowerCase();
    const shown = cards.filter(
      (card) =>
        (kind === "" || card.kind === kind) &&
        (needle === "" || card.name.toLowerCase().includes(needle)),
    );
    body =
      shown.length === 0 ? (
        <p className="text-text-muted">
          {cards.length === 0 ? "No cards of this origin or neutral yet." : "No cards match."}
        </p>
      ) : (
        <ul aria-label="Library cards" className="flex flex-wrap gap-2">
          {shown.map((card) => (
            <li key={card.id}>
              <LibraryCardButton
                card={card}
                origin={origins.find((candidate) => candidate.id === card.origin_id)}
                catalog={catalog}
                copies={copiesOf(entries, card.id)}
                canAdd={canAdd(entries, card.id)}
                onAdd={() => {
                  onAdd(card);
                }}
              />
            </li>
          ))}
        </ul>
      );
  }

  return (
    <section aria-labelledby="deck-library-title" className="flex min-w-0 flex-col gap-4">
      <h2 id="deck-library-title" className="text-lg font-semibold">
        Library
        {origin !== undefined && <span className="text-text-muted"> · {libraryName(origin)}</span>}
      </h2>
      <div className="flex flex-wrap gap-4">
        <SelectField
          label="Kind"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as CardKind | "");
          }}
        >
          <option value="">All kinds</option>
          <option value="creature">Creatures</option>
          <option value="spell">Spells</option>
        </SelectField>
        <TextField
          label="Search"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </div>
      {body}
    </section>
  );
}

function libraryName(origin: Origin): string {
  return origin.system_key === NEUTRAL_KEY ? origin.name : `${origin.name} + Neutral`;
}
