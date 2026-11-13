import { useNavigate } from "react-router";

import { ApiError, errorMessage } from "@/api/errors";
import { useImportShare, type SharePreview } from "@/api/hooks/useShare";
import { useCurrentUser } from "@/auth/useAuth";
import { librarySearch } from "@/features/cards/libraryParams";
import { Button } from "@/ui/Button";
import { ErrorAlert } from "@/ui/ErrorAlert";

interface ImportPanelProps {
  preview: SharePreview;
  /** The code stopped working between the preview and the import. */
  onGone: () => void;
}

/** What an import does, and the button that does it. */
export function ImportPanel({ preview, onGone }: ImportPanelProps) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const importShare = useImportShare(preview.code);

  let customOrigins = 0;
  if (preview.kind === "deck") customOrigins = Number(!preview.origin.is_system);
  if (preview.kind === "card_group") {
    customOrigins = preview.origins.filter((origin) => !origin.is_system).length;
  }
  const originsNote =
    customOrigins === 0
      ? ""
      : ` (and ${customOrigins === 1 ? "1 custom origin" : `${customOrigins} custom origins`})`;

  function startImport() {
    importShare.mutate(undefined, {
      onSuccess: (result) => {
        if (result.kind === "deck") void navigate(`/decks/${result.deck.id}`);
        if (result.kind === "ruleset") void navigate(`/rules/${result.ruleset.id}`);
        if (result.kind === "card_group") {
          void navigate(
            `/cards${librarySearch(new URLSearchParams(), { group: result.group.id })}`,
          );
        }
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === "share_not_found") onGone();
      },
    });
  }

  return (
    <section
      aria-labelledby="import-panel-title"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="import-panel-title" className="font-semibold">
        Import
      </h2>
      {preview.kind === "ruleset" ? (
        <p>
          Copies the rule set into your library. Your copy won't change when the author edits
          theirs.
        </p>
      ) : (
        <p>
          Copies the cards{originsNote} into your library
          {preview.kind === "deck" && ", in a new card group named after the deck"}. Your copy won't
          change when the author edits theirs.
        </p>
      )}
      {preview.author === user.username && (
        <p className="text-text-muted">This is yours: importing makes a copy.</p>
      )}
      {importShare.error !== null && <ErrorAlert>{errorMessage(importShare.error)}</ErrorAlert>}
      <Button className="self-start" busy={importShare.isPending} onClick={startImport}>
        Import to my library
      </Button>
    </section>
  );
}
