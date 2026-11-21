import { useId, useState } from "react";

import type { RulesetDefinition } from "@/api/hooks/useRulesets";
import { useCatalog } from "@/catalog/useCatalog";
import { RulesetSummary } from "@/features/rules/RulesetSummary";
import { Button } from "@/ui/Button";
import { LoadingState } from "@/ui/LoadingState";

/** "Show rules": a rule set in full, read-only, under a toggle. */
export function ShowRules({ definition }: { definition: RulesetDefinition }) {
  const [shown, setShown] = useState(false);
  const panelId = useId();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button
          variant="secondary"
          aria-expanded={shown}
          aria-controls={panelId}
          onClick={() => {
            setShown((current) => !current);
          }}
        >
          {shown ? "Hide rules" : "Show rules"}
        </Button>
      </div>
      <div id={panelId} hidden={!shown}>
        {shown && <RulesDetails definition={definition} />}
      </div>
    </div>
  );
}

function RulesDetails({ definition }: { definition: RulesetDefinition }) {
  const catalog = useCatalog();
  if (catalog.data === undefined) return <LoadingState error={catalog.error} />;
  return <RulesetSummary definition={definition} catalog={catalog.data} />;
}
