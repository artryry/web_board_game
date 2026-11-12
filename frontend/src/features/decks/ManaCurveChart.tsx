import { useId } from "react";

import type { DeckEntry } from "./deckEntries";
import { manaCurve } from "./manaCurve";

// The tallest bar's height, in rem. The others scale to it.
const BAR_MAX_REM = 4;

/** How many cards cost 0 to 6, and 7 or more, as bars. Information only. */
export function ManaCurveChart({ entries }: { entries: readonly DeckEntry[] }) {
  const titleId = useId();
  const bars = manaCurve(entries);
  const tallest = Math.max(1, ...bars.map((bar) => bar.count));

  return (
    <figure aria-labelledby={titleId} className="flex flex-col gap-2">
      <figcaption id={titleId} className="text-sm font-medium">
        Mana curve
      </figcaption>
      <div aria-hidden="true" className="flex items-end gap-1.5">
        {bars.map((bar) => (
          <div key={bar.label} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-xs text-text-muted">{bar.count}</span>
            <div
              className="w-full rounded-t-sm bg-accent"
              style={{ height: `${(bar.count / tallest) * BAR_MAX_REM}rem` }}
            />
            <span className="text-xs">{bar.label}</span>
          </div>
        ))}
      </div>
      <ul className="sr-only">
        {bars.map((bar) => (
          <li key={bar.label}>
            {bar.label} mana: {bar.count} {bar.count === 1 ? "card" : "cards"}
          </li>
        ))}
      </ul>
    </figure>
  );
}
