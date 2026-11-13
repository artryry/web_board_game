import { Link2 } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import type { Ruleset } from "@/api/hooks/useRulesets";

import { rulesetSummary } from "./rulesetValues";

interface RulesetListItemProps {
  ruleset: Ruleset;
  /** The links and buttons for this rule set. */
  actions: ReactNode;
}

/** One rule set: its name, a one-line summary, and whether it's shared. */
export function RulesetListItem({ ruleset, actions }: RulesetListItemProps) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">
          <Link to={`/rules/${ruleset.id}`} className="hover:underline">
            {ruleset.name}
          </Link>
        </h3>
        <p className="text-sm text-text-muted">{rulesetSummary(ruleset.definition)}</p>
        {ruleset.share_code !== null && (
          <p className="inline-flex items-center gap-1 text-sm text-text-muted">
            <Link2 aria-hidden="true" className="size-4" />
            Shared
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </li>
  );
}
