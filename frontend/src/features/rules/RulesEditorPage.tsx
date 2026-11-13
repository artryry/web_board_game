import { Link, useParams, useSearchParams } from "react-router";

import { ApiError } from "@/api/errors";
import { findDefaultRuleset, useRuleset, useRulesets } from "@/api/hooks/useRulesets";
import { useCatalog } from "@/catalog/useCatalog";
import { ButtonLink } from "@/ui/ButtonLink";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { LoadingState } from "@/ui/LoadingState";

import { RulesEditor } from "./RulesEditor";
import { duplicateValues, newValues, savedValues } from "./rulesetValues";

const NO_DEFAULT = new Error("The default rule set is missing");

/**
 * `/rules/new` (from the default, or `?from=<id>` to duplicate) and `/rules/:id`. The default
 * rule set's page is read-only, with Duplicate as the way to make it your own.
 */
export function RulesEditorPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const fromId = id === undefined ? (searchParams.get("from") ?? undefined) : undefined;
  const sourceId = id ?? fromId;
  const catalog = useCatalog();
  const rulesets = useRulesets();
  const source = useRuleset(sourceId);

  const backLink = (
    <Link to="/rules" className="text-sm text-accent hover:underline">
      ← Rule sets
    </Link>
  );

  if (source.error instanceof ApiError && source.error.status === 404) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <ErrorAlert>This rule set doesn't exist, or it isn't yours.</ErrorAlert>
      </div>
    );
  }
  // A new rule set starts from the default's rules.
  const defaultRuleset =
    rulesets.data === undefined ? undefined : findDefaultRuleset(rulesets.data);
  const base = sourceId === undefined ? defaultRuleset : source.data;
  if (catalog.data === undefined || base === undefined) {
    const missing = sourceId === undefined && rulesets.data !== undefined ? NO_DEFAULT : null;
    return <LoadingState error={catalog.error ?? source.error ?? rulesets.error ?? missing} />;
  }

  const isNew = id === undefined;
  const readOnly = !isNew && base.is_system;
  let title = "New rule set";
  if (fromId !== undefined) title = `Duplicate ${base.name}`;
  if (!isNew) title = readOnly ? base.name : `Edit ${base.name}`;
  let initial = savedValues(base);
  if (isNew) initial = fromId === undefined ? newValues(base) : duplicateValues(base);

  return (
    <section aria-labelledby="rules-editor-title" className="flex flex-col gap-6">
      {backLink}
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="rules-editor-title" className="text-2xl font-semibold">
          {title}
        </h1>
        {readOnly && (
          <span className="rounded-md border border-border-strong px-2 py-0.5 text-sm text-text-muted">
            Default
          </span>
        )}
      </div>
      {readOnly && (
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-text-muted">
            This is the default rule set. Duplicate it to make your own.
          </p>
          <ButtonLink to={`/rules/new?from=${base.id}`}>Duplicate</ButtonLink>
        </div>
      )}
      <RulesEditor
        key={`${id ?? "new"}:${fromId ?? ""}`}
        ruleset={isNew ? undefined : base}
        initial={initial}
        catalog={catalog.data}
        readOnly={readOnly}
      />
    </section>
  );
}
