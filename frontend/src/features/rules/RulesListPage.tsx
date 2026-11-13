import { useState } from "react";

import { useRulesets, type Ruleset } from "@/api/hooks/useRulesets";
import { ShareDialog, type ShareTarget } from "@/features/share/ShareDialog";
import { Button } from "@/ui/Button";
import { ButtonLink } from "@/ui/ButtonLink";
import { LoadingState } from "@/ui/LoadingState";

import { DeleteRulesetDialog } from "./DeleteRulesetDialog";
import { RulesetListItem } from "./RulesetListItem";

const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

/** `/rules`: the default rule set, then the user's own, by name (the server's order). */
export function RulesListPage() {
  const rulesets = useRulesets();
  const [sharing, setSharing] = useState<ShareTarget | null>(null);
  const [deleting, setDeleting] = useState<Ruleset | null>(null);

  if (rulesets.data === undefined) return <LoadingState error={rulesets.error} />;
  const system = rulesets.data.filter((ruleset) => ruleset.is_system);
  // The list holds only the user's own rule sets and the system ones.
  const own = rulesets.data.filter((ruleset) => !ruleset.is_system);

  return (
    <section aria-labelledby="rules-title" className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="rules-title" className="text-2xl font-semibold">
          Rule sets
        </h1>
        <ButtonLink to="/rules/new">New rule set</ButtonLink>
      </div>

      <section aria-labelledby="default-rules-title" className="flex flex-col gap-3">
        <h2 id="default-rules-title" className="text-lg font-semibold">
          Default
        </h2>
        <p className="text-text-muted">
          The rules every player can use. Duplicate them to make your own.
        </p>
        <ul className={GRID}>
          {system.map((ruleset) => (
            <RulesetListItem
              key={ruleset.id}
              ruleset={ruleset}
              actions={
                <>
                  <ButtonLink variant="secondary" to={`/rules/${ruleset.id}`}>
                    View <span className="sr-only">{ruleset.name}</span>
                  </ButtonLink>
                  <ButtonLink variant="secondary" to={`/rules/new?from=${ruleset.id}`}>
                    Duplicate <span className="sr-only">{ruleset.name}</span>
                  </ButtonLink>
                </>
              }
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="own-rules-title" className="flex flex-col gap-3">
        <h2 id="own-rules-title" className="text-lg font-semibold">
          My rule sets
        </h2>
        {own.length === 0 ? (
          <p className="text-text-muted">
            No rule sets yet. Duplicate the default, or start a new one.
          </p>
        ) : (
          <ul className={GRID}>
            {own.map((ruleset) => (
              <RulesetListItem
                key={ruleset.id}
                ruleset={ruleset}
                actions={
                  <>
                    <ButtonLink variant="secondary" to={`/rules/${ruleset.id}`}>
                      Edit <span className="sr-only">{ruleset.name}</span>
                    </ButtonLink>
                    <ButtonLink variant="secondary" to={`/rules/new?from=${ruleset.id}`}>
                      Duplicate <span className="sr-only">{ruleset.name}</span>
                    </ButtonLink>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSharing({
                          kind: "ruleset",
                          id: ruleset.id,
                          name: ruleset.name,
                          shareCode: ruleset.share_code,
                        });
                      }}
                    >
                      Share <span className="sr-only">{ruleset.name}</span>
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setDeleting(ruleset);
                      }}
                    >
                      Delete <span className="sr-only">{ruleset.name}</span>
                    </Button>
                  </>
                }
              />
            ))}
          </ul>
        )}
      </section>

      <ShareDialog
        target={sharing}
        onClose={() => {
          setSharing(null);
        }}
      />
      <DeleteRulesetDialog
        ruleset={deleting}
        onClose={() => {
          setDeleting(null);
        }}
        onDeleted={() => {
          setDeleting(null);
        }}
      />
    </section>
  );
}
