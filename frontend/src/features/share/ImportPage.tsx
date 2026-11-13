import { useState } from "react";
import { Link, useParams } from "react-router";

import { ApiError } from "@/api/errors";
import { useOrigins } from "@/api/hooks/useOrigins";
import { useSharePreview } from "@/api/hooks/useShare";
import { useCatalog } from "@/catalog/useCatalog";
import { RulesetSummary } from "@/features/rules/RulesetSummary";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { LoadingState } from "@/ui/LoadingState";

import { ImportPanel } from "./ImportPanel";
import { SharedContent } from "./SharedContent";

const KIND_NAMES = { deck: "Deck", card_group: "Card group", ruleset: "Rule set" };

/** `/share/:code`: a preview of someone's deck, card group or rule set, and the import. */
export function ImportPage() {
  const { code = "" } = useParams();
  const preview = useSharePreview(code);
  const catalog = useCatalog();
  const origins = useOrigins();
  const [gone, setGone] = useState(false);

  if (gone || (preview.error instanceof ApiError && preview.error.code === "share_not_found")) {
    return <LinkGone />;
  }
  if (preview.data === undefined || catalog.data === undefined || origins.data === undefined) {
    return <LoadingState error={preview.error ?? catalog.error ?? origins.error} />;
  }
  const shared = preview.data;

  return (
    <section aria-labelledby="import-title" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 id="import-title" className="text-2xl font-semibold">
          {shared.name}
        </h1>
        <p className="text-text-muted">
          {KIND_NAMES[shared.kind]} by {shared.author}
        </p>
      </div>
      <ImportPanel
        preview={shared}
        onGone={() => {
          setGone(true);
        }}
      />
      {shared.kind === "ruleset" ? (
        <RulesetSummary definition={shared.definition} catalog={catalog.data} />
      ) : (
        <SharedContent shared={shared} catalog={catalog.data} systemOrigins={origins.data} />
      )}
    </section>
  );
}

function LinkGone() {
  return (
    <div className="flex flex-col gap-4">
      <ErrorAlert>
        This link doesn't work any more. It may have been revoked, or the deck, group or rule set
        deleted.
      </ErrorAlert>
      <Link to="/" className="text-sm text-accent hover:underline">
        Go to the dashboard
      </Link>
    </div>
  );
}
