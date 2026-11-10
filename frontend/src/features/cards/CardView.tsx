import type { Origin } from "@/api/hooks/useOrigins";
import type { Catalog } from "@/catalog/useCatalog";
import { OriginIcon } from "@/features/origins/OriginIcon";
import { originHex } from "@/features/origins/originLook";
import { CardFrame } from "@/ui/CardFrame";

import { abilityNames, attackStat, type CardContent } from "./cardValues";

interface CardViewProps {
  name: string;
  manaCost: number;
  content: CardContent;
  artUrl: string | null;
  /** Undefined while origins load, or for an origin the user can't see any more. */
  origin: Origin | undefined;
  catalog: Catalog;
  size?: "sm" | "md";
}

/** A card in its frame, from a saved card or the editor's live values. */
export function CardView({
  name,
  manaCost,
  content,
  artUrl,
  origin,
  catalog,
  size = "sm",
}: CardViewProps) {
  // The editor's inputs may be briefly empty while the user types.
  const shown = (value: number) => (Number.isFinite(value) ? value : 0);
  return (
    <CardFrame
      name={name}
      cost={shown(manaCost)}
      hp={content.hp === null ? null : shown(content.hp)}
      attack={attackStat(content.dmg)}
      artUrl={artUrl}
      originName={origin?.name ?? "Unknown origin"}
      originHex={originHex(catalog, origin?.color ?? "grey")}
      originIcon={<OriginIcon icon={origin?.icon ?? "circle"} />}
      abilityNames={abilityNames(content, catalog)}
      size={size}
    />
  );
}
