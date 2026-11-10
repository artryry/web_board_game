import { useState } from "react";

import { useOrigins, type Origin } from "@/api/hooks/useOrigins";
import { useCatalog } from "@/catalog/useCatalog";
import { Button } from "@/ui/Button";
import { ButtonLink } from "@/ui/ButtonLink";
import { LoadingState } from "@/ui/LoadingState";

import { DeleteOriginDialog } from "./DeleteOriginDialog";
import { OriginListItem } from "./OriginListItem";

const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

/** The system templates, then the user's own origins. */
export function OriginListPage() {
  const catalog = useCatalog();
  const origins = useOrigins();
  const [deleting, setDeleting] = useState<Origin | null>(null);

  if (catalog.data === undefined || origins.data === undefined) {
    return <LoadingState error={catalog.error ?? origins.error} />;
  }
  const templates = origins.data.filter((origin) => origin.is_system);
  const own = origins.data.filter((origin) => !origin.is_system);

  return (
    <section aria-labelledby="origins-title" className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="origins-title" className="text-2xl font-semibold">
          Origins
        </h1>
        <ButtonLink to="/origins/new">New origin</ButtonLink>
      </div>

      <section aria-labelledby="templates-title" className="flex flex-col gap-3">
        <h2 id="templates-title" className="text-lg font-semibold">
          Templates
        </h2>
        <p className="text-text-muted">
          Ready-made origins that every player can use. Duplicate one to change it.
        </p>
        <ul className={GRID}>
          {templates.map((origin) => (
            <OriginListItem
              key={origin.id}
              origin={origin}
              catalog={catalog.data}
              actions={
                <>
                  <ButtonLink variant="secondary" to={`/origins/${origin.id}`}>
                    View <span className="sr-only">{origin.name}</span>
                  </ButtonLink>
                  <ButtonLink variant="secondary" to={`/origins/new?from=${origin.id}`}>
                    Duplicate <span className="sr-only">{origin.name}</span>
                  </ButtonLink>
                </>
              }
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="own-origins-title" className="flex flex-col gap-3">
        <h2 id="own-origins-title" className="text-lg font-semibold">
          My origins
        </h2>
        {own.length === 0 ? (
          <p className="text-text-muted">
            No origins yet. Create one, or duplicate a template above.
          </p>
        ) : (
          <ul className={GRID}>
            {own.map((origin) => (
              <OriginListItem
                key={origin.id}
                origin={origin}
                catalog={catalog.data}
                actions={
                  <>
                    <ButtonLink variant="secondary" to={`/origins/${origin.id}`}>
                      Edit <span className="sr-only">{origin.name}</span>
                    </ButtonLink>
                    <ButtonLink variant="secondary" to={`/origins/new?from=${origin.id}`}>
                      Duplicate <span className="sr-only">{origin.name}</span>
                    </ButtonLink>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setDeleting(origin);
                      }}
                    >
                      Delete <span className="sr-only">{origin.name}</span>
                    </Button>
                  </>
                }
              />
            ))}
          </ul>
        )}
      </section>

      <DeleteOriginDialog
        origin={deleting}
        onClose={() => {
          setDeleting(null);
        }}
      />
    </section>
  );
}
