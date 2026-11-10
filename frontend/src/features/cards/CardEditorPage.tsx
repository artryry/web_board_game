import { Link, useLocation, useParams, useSearchParams } from "react-router";

import { ApiError } from "@/api/errors";
import { useCard } from "@/api/hooks/useCards";
import { useCardGroups } from "@/api/hooks/useCardGroups";
import { useOrigins } from "@/api/hooks/useOrigins";
import { useCatalog } from "@/catalog/useCatalog";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { LoadingState } from "@/ui/LoadingState";

import { CardForm } from "./CardForm";
import { emptyCard, fromCard } from "./cardValues";
import { libraryReturnPath } from "./libraryParams";

/**
 * `/cards/new` (`?group=` and `?origin=` give starting values) and `/cards/:id`. It goes back to
 * the library view it was opened from.
 */
export function CardEditorPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const backTo = libraryReturnPath(location.state);
  const catalog = useCatalog();
  const origins = useOrigins();
  const groups = useCardGroups();
  const card = useCard(id);

  const backLink = (
    <Link to={backTo} className="text-sm text-accent hover:underline">
      ← Cards
    </Link>
  );

  if (card.error instanceof ApiError && card.error.status === 404) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <ErrorAlert>This card doesn't exist, or it isn't yours.</ErrorAlert>
      </div>
    );
  }
  if (
    catalog.data === undefined ||
    origins.data === undefined ||
    groups.data === undefined ||
    (id !== undefined && card.data === undefined)
  ) {
    return <LoadingState error={catalog.error ?? origins.error ?? groups.error ?? card.error} />;
  }

  const initial =
    card.data === undefined
      ? emptyCard(
          { origin: searchParams.get("origin"), group: searchParams.get("group") },
          origins.data,
          groups.data,
        )
      : fromCard(card.data);

  return (
    <section aria-labelledby="card-editor-title" className="flex flex-col gap-6">
      {backLink}
      <h1 id="card-editor-title" className="text-2xl font-semibold">
        {card.data === undefined ? "New card" : `Edit ${card.data.name}`}
      </h1>
      <CardForm
        key={id ?? "new"}
        catalog={catalog.data}
        origins={origins.data}
        groups={groups.data}
        initial={initial}
        card={card.data}
        backTo={backTo}
      />
    </section>
  );
}
