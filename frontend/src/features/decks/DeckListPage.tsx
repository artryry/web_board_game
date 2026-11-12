import { useState } from "react";

import { useDecks, type DeckSummary } from "@/api/hooks/useDecks";
import { useOrigins } from "@/api/hooks/useOrigins";
import { findDefaultRuleset, useRulesets } from "@/api/hooks/useRulesets";
import { useCatalog } from "@/catalog/useCatalog";
import { ShareDialog, type ShareTarget } from "@/features/share/ShareDialog";
import { Button } from "@/ui/Button";
import { ButtonLink } from "@/ui/ButtonLink";
import { LoadingState } from "@/ui/LoadingState";

import { DeckListItem } from "./DeckListItem";
import { DeleteDeckDialog } from "./DeleteDeckDialog";
import { ShareCodeForm } from "./ShareCodeForm";

/**
 * `/decks`: the user's decks, newest first. Each shows its size against the default ruleset; the
 * full check (copies, neutral cards) needs the cards, so it lives in the builder.
 */
export function DeckListPage() {
  const catalog = useCatalog();
  const origins = useOrigins();
  const rulesets = useRulesets();
  const decks = useDecks();
  const [sharing, setSharing] = useState<ShareTarget | null>(null);
  const [deleting, setDeleting] = useState<DeckSummary | null>(null);

  // The rulesets only add the target size, so the list still shows when they fail.
  const rulesetsLoading = rulesets.data === undefined && rulesets.error === null;
  if (catalog.data === undefined || origins.data === undefined || rulesetsLoading) {
    return <LoadingState error={catalog.error ?? origins.error} />;
  }
  const size =
    rulesets.data === undefined
      ? undefined
      : findDefaultRuleset(rulesets.data)?.definition.deck.size;
  const loaded = decks.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section aria-labelledby="decks-title" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="decks-title" className="text-2xl font-semibold">
          Decks
        </h1>
        <ButtonLink to="/decks/new">New deck</ButtonLink>
      </div>

      {decks.data === undefined ? (
        <LoadingState error={decks.error} />
      ) : loaded.length === 0 ? (
        <p className="text-text-muted">No decks yet.</p>
      ) : (
        <ul aria-label="Decks" className="flex flex-col gap-3">
          {loaded.map((deck) => (
            <DeckListItem
              key={deck.id}
              deck={deck}
              origin={origins.data.find((origin) => origin.id === deck.origin_id)}
              catalog={catalog.data}
              size={size}
              onShare={() => {
                setSharing({
                  kind: "deck",
                  id: deck.id,
                  name: deck.name,
                  shareCode: deck.share_code,
                });
              }}
              onDelete={() => {
                setDeleting(deck);
              }}
            />
          ))}
        </ul>
      )}
      {decks.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          busy={decks.isFetchingNextPage}
          onClick={() => void decks.fetchNextPage()}
        >
          Load more
        </Button>
      )}

      <ShareCodeForm />

      <ShareDialog
        target={sharing}
        onClose={() => {
          setSharing(null);
        }}
      />
      <DeleteDeckDialog
        deck={deleting}
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
