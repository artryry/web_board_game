import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { useState, type ReactNode } from "react";

import type { Card } from "@/api/hooks/useCards";
import type { Origin } from "@/api/hooks/useOrigins";
import type { Catalog } from "@/catalog/useCatalog";
import { CardView } from "@/features/cards/CardView";
import { DRAG_DISTANCE_PX } from "@/ui/dragDistance";

import { DECK_DROP_ID } from "./DeckPanel";

interface DeckDndProps {
  /** The library's cards, which are the draggable ones. */
  cards: readonly Card[] | undefined;
  origins: readonly Origin[];
  catalog: Catalog;
  onDropOnDeck: (card: Card) => void;
  children: ReactNode;
}

/**
 * Dragging library cards onto the deck. Only the pointer drags: keyboard users add a card with
 * its button, so there is no keyboard sensor.
 */
export function DeckDnd({ cards, origins, catalog, onDropOnDeck, children }: DeckDndProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE_PX } }),
  );
  const [draggedId, setDraggedId] = useState<UniqueIdentifier | null>(null);
  const cardOf = (id: UniqueIdentifier) => cards?.find((card) => card.id === id);
  const nameOf = (id: UniqueIdentifier) => cardOf(id)?.name ?? "The card";
  const dragged = draggedId === null ? undefined : cardOf(draggedId);

  // The live region's words for a drag; dnd-kit's own would read out the card's id.
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over === null ? undefined : `${nameOf(active.id)} is over the deck.`,
    onDragEnd: ({ active, over }) =>
      over === null ? `${nameOf(active.id)} was put back.` : `Added ${nameOf(active.id)}.`,
    onDragCancel: ({ active }) => `${nameOf(active.id)} was put back.`,
  };

  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements }}
      onDragStart={({ active }) => {
        setDraggedId(active.id);
      }}
      onDragEnd={({ active, over }) => {
        setDraggedId(null);
        const card = cardOf(active.id);
        if (over?.id === DECK_DROP_ID && card !== undefined) onDropOnDeck(card);
      }}
      onDragCancel={() => {
        setDraggedId(null);
      }}
    >
      {children}
      <DragOverlay>
        {dragged !== undefined && (
          <div className="rotate-2 cursor-grabbing opacity-90">
            <CardView
              name={dragged.name}
              manaCost={dragged.mana_cost}
              content={dragged}
              artUrl={dragged.art_url}
              origin={origins.find((origin) => origin.id === dragged.origin_id)}
              catalog={catalog}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
