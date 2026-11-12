import { useDraggable } from "@dnd-kit/core";
import { useId } from "react";

import { MAX_COPIES } from "@/api/bounds";
import type { Card } from "@/api/hooks/useCards";
import type { Origin } from "@/api/hooks/useOrigins";
import type { Catalog } from "@/catalog/useCatalog";
import { CardView } from "@/features/cards/CardView";

interface LibraryCardButtonProps {
  card: Card;
  origin: Origin | undefined;
  catalog: Catalog;
  copies: number;
  canAdd: boolean;
  onAdd: () => void;
}

/**
 * A library card that adds one copy to the deck when clicked (or pressed with Enter or Space),
 * and can be dragged onto the deck. Only the pointer drags: the drag starts after a small move,
 * so a click still adds, and the keyboard keeps the button's own Enter and Space.
 */
export function LibraryCardButton({
  card,
  origin,
  catalog,
  copies,
  canAdd,
  onAdd,
}: LibraryCardButtonProps) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: card.id, disabled: !canAdd });
  const copiesId = useId();

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      onClick={onAdd}
      disabled={!canAdd}
      aria-label={`Add ${card.name}`}
      aria-describedby={copiesId}
      className={`flex flex-col items-center gap-1 rounded-lg p-1 enabled:cursor-grab enabled:hover:bg-surface-raised disabled:opacity-60 ${isDragging ? "opacity-40" : ""}`}
    >
      <CardView
        name={card.name}
        manaCost={card.mana_cost}
        content={card}
        artUrl={card.art_url}
        origin={origin}
        catalog={catalog}
      />
      <span id={copiesId} className="text-sm text-text-muted">
        {copies === 0 ? "Not in deck" : `${copies} in deck${copies >= MAX_COPIES ? " (full)" : ""}`}
      </span>
    </button>
  );
}
