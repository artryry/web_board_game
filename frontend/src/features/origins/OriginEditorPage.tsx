import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { ApiError } from "@/api/errors";
import {
  useCreateOrigin,
  useOrigin,
  useUpdateOrigin,
  type OriginBody,
} from "@/api/hooks/useOrigins";
import { useCatalog } from "@/catalog/useCatalog";
import { ButtonLink } from "@/ui/ButtonLink";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { LoadingState } from "@/ui/LoadingState";

import { OriginForm } from "./OriginForm";
import { duplicateOf, emptyOrigin, fromOrigin } from "./originValues";

/**
 * `/origins/new` (from scratch, or `?from=<id>` to duplicate) and `/origins/:id`. A system
 * origin's page is read-only, with Duplicate as the way to make it your own.
 */
export function OriginEditorPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const fromId = id === undefined ? (searchParams.get("from") ?? undefined) : undefined;
  const sourceId = id ?? fromId;
  const navigate = useNavigate();
  const catalog = useCatalog();
  const origin = useOrigin(sourceId);
  const create = useCreateOrigin();
  const update = useUpdateOrigin();

  const backLink = (
    <Link to="/origins" className="text-sm text-accent hover:underline">
      ← Origins
    </Link>
  );

  if (origin.error instanceof ApiError && origin.error.status === 404) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <ErrorAlert>This origin doesn't exist, or it isn't yours.</ErrorAlert>
      </div>
    );
  }
  const source = origin.data;
  if (catalog.data === undefined || (sourceId !== undefined && source === undefined)) {
    return <LoadingState error={catalog.error ?? origin.error} />;
  }

  const isNew = id === undefined;
  const readOnly = !isNew && source?.is_system === true;
  const initial =
    source === undefined
      ? emptyOrigin(catalog.data)
      : isNew
        ? duplicateOf(source)
        : fromOrigin(source);
  let title = "New origin";
  if (source !== undefined) {
    title = isNew ? `Duplicate ${source.name}` : readOnly ? source.name : `Edit ${source.name}`;
  }

  async function save(body: OriginBody) {
    if (id === undefined) await create.mutateAsync(body);
    else await update.mutateAsync({ id, body });
    await navigate("/origins");
  }

  return (
    <section aria-labelledby="origin-editor-title" className="flex flex-col gap-6">
      {backLink}
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="origin-editor-title" className="text-2xl font-semibold">
          {title}
        </h1>
        {readOnly && (
          <span className="rounded-md border border-border-strong px-2 py-0.5 text-sm text-text-muted">
            Template
          </span>
        )}
      </div>
      {readOnly && (
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-text-muted">
            Templates can't be changed. Duplicate this one to make your own version.
          </p>
          <ButtonLink to={`/origins/new?from=${id}`}>Duplicate</ButtonLink>
        </div>
      )}
      <OriginForm
        key={`${id ?? "new"}:${fromId ?? ""}`}
        catalog={catalog.data}
        initial={initial}
        savedArt={
          source === undefined
            ? undefined
            : { key: source.background_art_key, url: source.background_art_url }
        }
        readOnly={readOnly}
        submitLabel={isNew ? "Create origin" : "Save"}
        onSubmit={save}
        onCancel={() => void navigate("/origins")}
      />
    </section>
  );
}
