import { useDroppable } from "@dnd-kit/core";
import { Minus, Plus } from "lucide-react";

import { MAX_DECK_SIZE } from "@/api/bounds";
import type { Card } from "@/api/hooks/useCards";
import type { Origin } from "@/api/hooks/useOrigins";
import { OriginIcon } from "@/features/origins/OriginIcon";
import { IconButton } from "@/ui/IconButton";

import { canAdd, deckSize, type DeckEntry } from "./deckEntries";

/** The drop target's id: library cards dropped on it are added to the deck. */
export const DECK_DROP_ID = "deck";

interface DeckPanelProps {
  entries: readonly DeckEntry[];
  origins: readonly Origin[];
  onAdd: (card: Card) => void;
  onRemove: (card: Card) => void;
}

/** The deck's cards with their copies, and the drop target for dragged library cards. */
export function DeckPanel({ entries, origins, onAdd, onRemove }: DeckPanelProps) {
  const { setNodeRef, isOver, active } = useDroppable({ id: DECK_DROP_ID });
  const size = deckSize(entries);
  const outline = isOver
    ? "border-accent bg-surface-raised"
    : active !== null
      ? "border-dashed border-border-strong"
      : "border-border";

  return (
    <section
      ref={setNodeRef}
      aria-labelledby="deck-cards-title"
      className={`flex flex-col gap-3 rounded-lg border-2 p-4 ${outline}`}
    >
      <h2 id="deck-cards-title" className="text-lg font-semibold">
        Deck <span className="text-text-muted">· {size === 1 ? "1 card" : `${size} cards`}</span>
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-text-muted">Click or drag library cards here.</p>
      ) : (
        <ul aria-label="Deck cards" className="flex flex-col gap-1">
          {entries.map((entry) => (
            <DeckRow
              key={entry.card.id}
              entry={entry}
              origin={origins.find((origin) => origin.id === entry.card.origin_id)}
              canAddOne={canAdd(entries, entry.card.id)}
              onAdd={() => {
                onAdd(entry.card);
              }}
              onRemove={() => {
                onRemove(entry.card);
              }}
            />
          ))}
        </ul>
      )}
      {size >= MAX_DECK_SIZE && (
        <p className="text-sm text-text-muted">A deck holds at most {MAX_DECK_SIZE} cards.</p>
      )}
    </section>
  );
}

interface DeckRowProps {
  entry: DeckEntry;
  origin: Origin | undefined;
  canAddOne: boolean;
  onAdd: () => void;
  onRemove: () => void;
}

function DeckRow({ entry, origin, canAddOne, onAdd, onRemove }: DeckRowProps) {
  const { card, count } = entry;
  return (
    <li className="flex items-center gap-2 rounded-md px-1 hover:bg-surface-raised">
      <span className="w-6 text-center font-mono text-sm">
        {card.mana_cost}
        <span className="sr-only"> mana</span>
      </span>
      {origin !== undefined && (
        <span title={origin.name} className="text-text-muted">
          <OriginIcon icon={origin.icon} />
          <span className="sr-only">{origin.name}</span>
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{card.name}</span>
      <IconButton label={`Remove one ${card.name}`} onClick={onRemove}>
        <Minus aria-hidden="true" className="size-4" />
      </IconButton>
      <span className="w-5 text-center font-mono text-sm">
        {count}
        <span className="sr-only"> {count === 1 ? "copy" : "copies"}</span>
      </span>
      <IconButton label={`Add one ${card.name}`} onClick={onAdd} disabled={!canAddOne}>
        <Plus aria-hidden="true" className="size-4" />
      </IconButton>
    </li>
  );
}
