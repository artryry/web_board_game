import type { ReactNode } from "react";

export interface CardFrameProps {
  name: string;
  cost: number;
  /** Null hides the stat, as for a spell. */
  hp: number | null;
  /** The attack stat with its label ("DMG", "Heal"), or null to hide it. */
  attack: { label: string; value: number } | null;
  artUrl: string | null;
  originName: string;
  originHex: string;
  originIcon: ReactNode;
  abilityNames: readonly string[];
  size?: "sm" | "md";
}

const SIZES = {
  sm: { frame: "w-44 text-xs", name: "text-sm", gem: "size-7 text-sm" },
  md: { frame: "w-64 text-sm", name: "text-base", gem: "size-9 text-base" },
};

/**
 * How a card looks, in the library, the editor and on the board. It only displays what it is
 * given. The origin colour is a band and a tint, never behind text, so every colour keeps the
 * text readable; the origin's icon and name always come with it.
 */
export function CardFrame({
  name,
  cost,
  hp,
  attack,
  artUrl,
  originName,
  originHex,
  originIcon,
  abilityNames,
  size = "sm",
}: CardFrameProps) {
  const sizes = SIZES[size];
  return (
    <article
      aria-label={name}
      className={`flex flex-col overflow-hidden rounded-lg border border-border-strong bg-surface-raised ${sizes.frame}`}
    >
      <div aria-hidden="true" className="h-1.5" style={{ backgroundColor: originHex }} />
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span
          className={`flex shrink-0 items-center justify-center rounded-full bg-accent font-bold text-bg ${sizes.gem}`}
        >
          <span className="sr-only">Cost </span>
          {cost}
        </span>
        <p className={`truncate font-semibold ${sizes.name}`}>{name}</p>
      </div>
      <div className="relative aspect-[4/3] bg-surface">
        {artUrl === null ? (
          <div className="flex size-full items-center justify-center text-text-muted">
            <span
              aria-hidden="true"
              className="absolute inset-0 opacity-25"
              style={{ backgroundColor: originHex }}
            />
            <span className="relative [&>svg]:size-10">{originIcon}</span>
          </div>
        ) : (
          <img src={artUrl} alt="" className="size-full object-cover" />
        )}
      </div>
      <p className="flex items-center gap-1 px-2 pt-1.5 text-text-muted">
        {originIcon}
        <span className="truncate">{originName}</span>
      </p>
      <ul className="min-h-5 px-2 pt-1">
        {abilityNames.map((ability) => (
          <li key={ability} className="truncate">
            {ability}
          </li>
        ))}
      </ul>
      <dl className="mt-auto flex justify-between px-2 py-1.5 font-semibold">
        {attack === null ? (
          <div />
        ) : (
          <div className="flex gap-1">
            <dt className="text-text-muted">{attack.label}</dt>
            <dd>{attack.value}</dd>
          </div>
        )}
        {hp !== null && (
          <div className="flex gap-1">
            <dt className="text-text-muted">HP</dt>
            <dd>{hp}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}
