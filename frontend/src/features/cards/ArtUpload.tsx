import { ImageOff } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { ART_CONTENT_TYPES } from "@/api/bounds";
import { Button } from "@/ui/Button";

import { ART_LIMITS_TEXT, type ArtField } from "./useArtField";

interface ArtUploadProps {
  label: string;
  art: ArtField;
  /** The frame the art is cropped to: a card's art window or a board section. */
  frame: "card" | "section";
  /** The server's answer on save, such as `invalid_art_key`. */
  error?: string | undefined;
}

const FRAMES = { card: "aspect-[4/3]", section: "aspect-video" };

/**
 * Picks card art or an origin background. The file is uploaded unchanged; the preview is
 * cropped by CSS to the frame it will be shown in. Used by the card and origin editors.
 */
export function ArtUpload({ label, art, frame, error }: ArtUploadProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const message = art.error ?? error;
  const hasError = message !== undefined && message !== "";
  const inputRef = useRef<HTMLInputElement>(null);

  // A good pick keeps its file name on show. After an error or a removal the input is cleared,
  // so picking the same file again still counts as a change.
  useEffect(() => {
    if ((art.error !== null || !art.hasArt) && inputRef.current !== null) {
      inputRef.current.value = "";
    }
  }, [art.error, art.hasArt]);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex flex-wrap items-start gap-4">
        <div
          className={`w-40 overflow-hidden rounded-md border border-border-strong bg-surface ${FRAMES[frame]}`}
        >
          {art.previewUrl === null ? (
            <div className="flex size-full items-center justify-center text-text-muted">
              <ImageOff aria-hidden="true" className="size-6" />
            </div>
          ) : (
            <img src={art.previewUrl} alt={`${label} preview`} className="size-full object-cover" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ART_CONTENT_TYPES.join(",")}
            aria-describedby={hasError ? `${hintId} ${errorId}` : hintId}
            aria-invalid={hasError || undefined}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) art.pick(file);
            }}
            className="max-w-full text-sm text-text-muted file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-surface-raised file:px-3 file:py-1.5 file:text-text"
          />
          <p id={hintId} className="text-xs text-text-muted">
            {ART_LIMITS_TEXT} It is cropped to fit the frame.
          </p>
          {art.uploading && (
            <p role="status" className="text-sm text-text-muted">
              Uploading…
            </p>
          )}
          {art.hasArt && (
            <Button variant="secondary" onClick={art.remove}>
              Remove <span className="sr-only">{label.toLowerCase()}</span>
            </Button>
          )}
          {hasError && (
            <p id={errorId} role="alert" className="text-sm text-danger">
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
