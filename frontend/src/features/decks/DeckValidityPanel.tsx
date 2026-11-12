import { CircleCheck, CircleX } from "lucide-react";
import { useState, type ReactNode } from "react";

import { findDefaultRuleset, type Ruleset } from "@/api/hooks/useRulesets";
import { SelectField } from "@/ui/SelectField";

import { deckSize, type DeckEntry } from "./deckEntries";
import { deckProblems } from "./deckProblems";

interface DeckValidityPanelProps {
  entries: readonly DeckEntry[];
  /** Undefined when they didn't load. */
  rulesets: readonly Ruleset[] | undefined;
  /** The deck's origin, or "" before one is picked. */
  originId: string;
  neutralId: string;
}

/**
 * The deck against a ruleset's deck rules: the default ruleset, or one the user picks. Information
 * only: saving never depends on it, and the server checks the deck when it's picked for a room.
 */
export function DeckValidityPanel({
  entries,
  rulesets,
  originId,
  neutralId,
}: DeckValidityPanelProps) {
  const [chosenId, setChosenId] = useState<string | null>(null);

  if (rulesets === undefined || rulesets.length === 0) {
    return (
      <p className="text-sm text-text-muted">The rule sets couldn't load, so there's no check.</p>
    );
  }
  const ruleset =
    rulesets.find((candidate) => candidate.id === chosenId) ??
    findDefaultRuleset(rulesets) ??
    rulesets[0];
  if (ruleset === undefined) return null;
  const rules = ruleset.definition.deck;
  const problems = deckProblems(entries, rules, { deck: originId, neutral: neutralId });
  const size = problems.find((problem) => problem.kind === "size");
  const copies = problems.find((problem) => problem.kind === "copies");
  const neutral = problems.find((problem) => problem.kind === "neutral");

  let neutralText = "Neutral cards allowed";
  if (!rules.allow_neutral) {
    if (neutral !== undefined)
      neutralText = `Neutral cards not allowed: ${neutral.cards.join(", ")}`;
    else if (originId === neutralId) neutralText = "Neutral cards are this deck's own origin";
    else neutralText = "No neutral cards";
  }

  return (
    <section aria-labelledby="deck-checks-title" className="flex flex-col gap-3">
      <h2 id="deck-checks-title" className="text-sm font-medium">
        Rules check
      </h2>
      <SelectField
        label="Rules"
        value={ruleset.id}
        onChange={(event) => {
          setChosenId(event.target.value);
        }}
      >
        {rulesets.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </SelectField>
      <ul aria-label="Deck checks" className="flex flex-col gap-1.5 text-sm">
        <Check ok={size === undefined}>
          {deckSize(entries)} / {rules.size} cards
        </Check>
        <Check ok={copies === undefined}>
          {copies === undefined
            ? `At most ${rules.max_copies} of each card`
            : `More than ${rules.max_copies} copies: ${copies.cards.join(", ")}`}
        </Check>
        <Check ok={neutral === undefined}>{neutralText}</Check>
      </ul>
      <p className="text-xs text-text-muted">
        Information only: the server checks the deck when it's picked for a room.
      </p>
    </section>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icon = ok ? CircleCheck : CircleX;
  return (
    <li className="flex items-start gap-2">
      <Icon
        aria-hidden="true"
        className={`mt-0.5 size-4 shrink-0 ${ok ? "text-success" : "text-danger"}`}
      />
      <span>
        <span className="sr-only">{ok ? "Passes: " : "Problem: "}</span>
        {children}
      </span>
    </li>
  );
}
