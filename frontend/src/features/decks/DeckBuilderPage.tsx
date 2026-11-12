import { Link, useParams } from "react-router";

import { ApiError } from "@/api/errors";
import { useDeck } from "@/api/hooks/useDecks";
import { findNeutral, useOrigins } from "@/api/hooks/useOrigins";
import { useRulesets } from "@/api/hooks/useRulesets";
import { useCatalog } from "@/catalog/useCatalog";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { LoadingState } from "@/ui/LoadingState";

import { DeckBuilder } from "./DeckBuilder";

const backLink = (
  <Link to="/decks" className="text-sm text-accent hover:underline">
    ← Decks
  </Link>
);

/** `/decks/new` and `/decks/:id`. A new deck is created on its first Save. */
export function DeckBuilderPage() {
  const { id } = useParams();
  const catalog = useCatalog();
  const origins = useOrigins();
  const rulesets = useRulesets();
  const deck = useDeck(id);

  if (deck.error instanceof ApiError && deck.error.status === 404) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <ErrorAlert>This deck doesn't exist, or it isn't yours.</ErrorAlert>
      </div>
    );
  }
  // The rulesets only feed the validity panel, so the builder still opens when they fail.
  const rulesetsLoading = rulesets.data === undefined && rulesets.error === null;
  const neutral = origins.data === undefined ? undefined : findNeutral(origins.data);
  if (
    catalog.data === undefined ||
    origins.data === undefined ||
    neutral === undefined ||
    rulesetsLoading ||
    (id !== undefined && deck.data === undefined)
  ) {
    return <LoadingState error={catalog.error ?? origins.error ?? deck.error} />;
  }

  return (
    <section aria-labelledby="deck-builder-title" className="flex flex-col gap-6">
      {backLink}
      <h1 id="deck-builder-title" className="text-2xl font-semibold">
        {deck.data === undefined ? "New deck" : `Edit ${deck.data.name}`}
      </h1>
      <DeckBuilder
        key={id ?? "new"}
        deck={deck.data}
        catalog={catalog.data}
        origins={origins.data}
        rulesets={rulesets.data}
        neutralId={neutral.id}
      />
    </section>
  );
}
