import { useState } from "react";
import { useLocation, useSearchParams } from "react-router";

import { useCards, UNGROUPED, type Card } from "@/api/hooks/useCards";
import { useCardGroups } from "@/api/hooks/useCardGroups";
import { useOrigins } from "@/api/hooks/useOrigins";
import { useCatalog } from "@/catalog/useCatalog";
import { Button } from "@/ui/Button";
import { ButtonLink } from "@/ui/ButtonLink";
import { LoadingState } from "@/ui/LoadingState";

import { CardGroupPanel } from "./CardGroupPanel";
import { LibraryCard } from "./LibraryCard";
import { LibraryFilters } from "./LibraryFilters";
import { libraryFilters, librarySearch, newCardPath, type LibraryParam } from "./libraryParams";
import { MoveToGroupDialog } from "./MoveToGroupDialog";

/** `/cards`: the user's cards by group, with filters, balance labels and paging. */
export function CardLibraryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const filters = libraryFilters(searchParams);
  const catalog = useCatalog();
  const origins = useOrigins();
  const groups = useCardGroups();
  const cards = useCards(filters);
  const [moving, setMoving] = useState<Card | null>(null);

  function setParam(param: LibraryParam, value: string | null) {
    setSearchParams(librarySearch(searchParams, { [param]: value }));
  }

  if (catalog.data === undefined || origins.data === undefined || groups.data === undefined) {
    return <LoadingState error={catalog.error ?? origins.error ?? groups.error} />;
  }
  const viewName =
    filters.group === undefined
      ? "All cards"
      : filters.group === UNGROUPED
        ? "Ungrouped"
        : (groups.data.find((group) => group.id === filters.group)?.name ?? "Unknown group");
  const loaded = cards.data?.pages.flatMap((page) => page.items) ?? [];
  const from = `${location.pathname}${location.search}`;

  return (
    <div className="grid gap-8 md:grid-cols-[14rem_minmax(0,1fr)]">
      <CardGroupPanel
        groups={groups.data}
        active={filters.group}
        onGroupDeleted={(group) => {
          if (filters.group === group.id) setParam("group", null);
        }}
      />
      <section aria-labelledby="library-title" className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 id="library-title" className="text-2xl font-semibold">
            Cards <span className="text-text-muted">· {viewName}</span>
          </h1>
          <ButtonLink to={newCardPath(filters)} state={{ from }}>
            New card
          </ButtonLink>
        </div>
        <LibraryFilters origins={origins.data} filters={filters} onChange={setParam} />
        {cards.data === undefined ? (
          <LoadingState error={cards.error} />
        ) : loaded.length === 0 ? (
          <p className="text-text-muted">No cards here yet.</p>
        ) : (
          <ul aria-label="Cards" className="flex flex-wrap gap-4">
            {loaded.map((card) => (
              <LibraryCard
                key={card.id}
                card={card}
                origin={origins.data.find((origin) => origin.id === card.origin_id)}
                catalog={catalog.data}
                from={from}
                onMove={setMoving}
              />
            ))}
          </ul>
        )}
        {cards.hasNextPage && (
          <Button
            variant="secondary"
            className="self-center"
            busy={cards.isFetchingNextPage}
            onClick={() => void cards.fetchNextPage()}
          >
            Load more
          </Button>
        )}
      </section>
      <MoveToGroupDialog
        card={moving}
        groups={groups.data}
        onClose={() => {
          setMoving(null);
        }}
      />
    </div>
  );
}
