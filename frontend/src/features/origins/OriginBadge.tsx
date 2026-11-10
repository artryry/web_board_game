import { OriginIcon } from "./OriginIcon";

interface OriginBadgeProps {
  name: string;
  icon: string;
  hex: string;
}

/**
 * An origin as a swatch, its icon and its name, so the colour is never the only signal. The
 * swatch has an outline, so dark colours such as black stay visible on the dark table.
 */
export function OriginBadge({ name, icon, hex }: OriginBadgeProps) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className="size-3 shrink-0 rounded-full border border-border-strong"
        style={{ backgroundColor: hex }}
      />
      <OriginIcon icon={icon} />
      <span className="truncate">{name}</span>
    </span>
  );
}
