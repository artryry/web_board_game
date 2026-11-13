import { useWatch } from "react-hook-form";

import type { RulesFormValues } from "./rulesetValues";

// A drawing limit, not a rule: it keeps a typo from drawing hundreds of boxes. The server's check
// reports the real bounds under the fields.
const MAX_DRAWN = 10;

function drawable(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_DRAWN;
}

/**
 * A small picture of the board: one column per lane, and two rows of sections (one per player, as
 * on the game board), each with its slots. It follows the fields as they change.
 */
export function BoardThumbnail() {
  const [lanes, slots] = useWatch<RulesFormValues, ["board.lanes", "board.slots_per_section"]>({
    name: ["board.lanes", "board.slots_per_section"],
  });

  if (!drawable(lanes) || !drawable(slots)) {
    return <p className="text-sm text-text-muted">No board preview for these numbers.</p>;
  }
  const sections = Array.from({ length: lanes * 2 }, (_, index) => index);
  const slotBoxes = Array.from({ length: slots }, (_, index) => index);

  return (
    <div
      role="img"
      aria-label={`Board: ${lanes} ${lanes === 1 ? "lane" : "lanes"}, ${slots} ${slots === 1 ? "slot" : "slots"} per section`}
      className="grid w-full max-w-xs gap-1 rounded-md border border-border bg-bg p-2"
      style={{ gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))` }}
    >
      {sections.map((section) => (
        <div
          key={section}
          className="flex justify-center gap-0.5 rounded-sm border border-border-strong p-1"
        >
          {slotBoxes.map((slot) => (
            <div key={slot} className="h-3 min-w-0 flex-1 rounded-xs bg-surface-raised" />
          ))}
        </div>
      ))}
    </div>
  );
}
