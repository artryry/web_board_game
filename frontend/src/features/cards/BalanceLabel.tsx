import { ArrowDown, ArrowUp, Check } from "lucide-react";

import type { Card } from "@/api/hooks/useCards";

interface BalanceLabelProps {
  balance: Card["balance"];
  suggested: number;
}

/**
 * The server's balance label, as information only: the words carry the meaning, and the icon and
 * colour only repeat it. "Under-costed" means cheaper than the suggestion.
 */
export function BalanceLabel({ balance, suggested }: BalanceLabelProps) {
  return (
    <p className="flex items-center gap-1 text-xs">
      <BalanceWord balance={balance} />{" "}
      <span className="text-text-muted">· suggested {suggested}</span>
    </p>
  );
}

function BalanceWord({ balance }: { balance: Card["balance"] }) {
  switch (balance) {
    case "under":
      return (
        <span className="inline-flex items-center gap-1 font-medium text-accent">
          <ArrowDown aria-hidden="true" className="size-3.5" />
          Under-costed
        </span>
      );
    case "balanced":
      return (
        <span className="inline-flex items-center gap-1 font-medium text-success">
          <Check aria-hidden="true" className="size-3.5" />
          Balanced
        </span>
      );
    case "over":
      return (
        <span className="inline-flex items-center gap-1 font-medium text-accent">
          <ArrowUp aria-hidden="true" className="size-3.5" />
          Over-costed
        </span>
      );
  }
}
