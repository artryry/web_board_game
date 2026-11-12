import { Link2, Share2, Trash2 } from "lucide-react";
import { Link } from "react-router";

import type { DeckSummary } from "@/api/hooks/useDecks";
import type { Origin } from "@/api/hooks/useOrigins";
import type { Catalog } from "@/catalog/useCatalog";
import { OriginBadge } from "@/features/origins/OriginBadge";
import { originHex } from "@/features/origins/originLook";
import { IconButton } from "@/ui/IconButton";

interface DeckListItemProps {
  deck: DeckSummary;
  origin: Origin | undefined;
  catalog: Catalog;
  /** The default ruleset's deck size, or undefined when the rulesets didn't load. */
  size: number | undefined;
  onShare: () => void;
  onDelete: () => void;
}

/** One deck: its name, origin, card count against the default size, and whether it's shared. */
export function DeckListItem({
  deck,
  origin,
  catalog,
  size,
  onShare,
  onDelete,
}: DeckListItemProps) {
  return (
    <li className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link to={`/decks/${deck.id}`} className="truncate font-medium hover:underline">
          {deck.name}
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted">
          {origin !== undefined && (
            <OriginBadge
              name={origin.name}
              icon={origin.icon}
              hex={originHex(catalog, origin.color)}
            />
          )}
          <span>{size === undefined ? deck.card_count : `${deck.card_count} / ${size}`} cards</span>
          {deck.share_code !== null && (
            <span className="inline-flex items-center gap-1">
              <Link2 aria-hidden="true" className="size-4" />
              Shared
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <IconButton label={`Share ${deck.name}`} onClick={onShare}>
          <Share2 aria-hidden="true" className="size-4" />
        </IconButton>
        <IconButton label={`Delete ${deck.name}`} onClick={onDelete}>
          <Trash2 aria-hidden="true" className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}
