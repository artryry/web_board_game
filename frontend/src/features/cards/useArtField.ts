import { useEffect, useRef, useState } from "react";
import {
  useWatch,
  type FieldValues,
  type Path,
  type PathValue,
  type UseFormReturn,
} from "react-hook-form";

import { ART_CONTENT_TYPES, ART_MAX_BYTES } from "@/api/bounds";
import { errorMessage } from "@/api/errors";
import { useArtUpload } from "@/api/hooks/useArtUpload";
import { ArtUploadError, type ArtKind } from "@/api/uploadArt";

export const ART_LIMITS_TEXT = `PNG, JPEG or WebP, up to ${ART_MAX_BYTES / (1024 * 1024)} MB.`;

export interface ArtField {
  /** The picked file, or the saved art while its key is unchanged. */
  previewUrl: string | null;
  hasArt: boolean;
  uploading: boolean;
  error: string | null;
  pick: (file: File) => void;
  remove: () => void;
}

interface ArtFieldOptions<T extends FieldValues> {
  form: UseFormReturn<T>;
  /** The form field that holds the key: `art_key` or `background_art_key`. */
  name: Path<T>;
  kind: ArtKind;
  /** The saved card's or origin's art, shown until the key changes. */
  saved: { key: string | null; url: string | null } | undefined;
}

/**
 * The art field of an editor form. A picked file is checked, then uploaded at once, so Save
 * stays quick and an upload error shows straight away; the key it gets is saved with the form.
 * A newer pick wins over an upload that is still running.
 */
export function useArtField<T extends FieldValues>({
  form,
  name,
  kind,
  saved,
}: ArtFieldOptions<T>): ArtField {
  const value: unknown = useWatch({ control: form.control, name });
  const key = typeof value === "string" ? value : null;
  const upload = useArtUpload(kind);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestPick = useRef(0);

  // A picked file's preview lives until the next pick, a removal or the editor closing.
  useEffect(() => {
    if (localUrl === null) return;
    return () => {
      URL.revokeObjectURL(localUrl);
    };
  }, [localUrl]);

  function setKey(next: string | null) {
    form.setValue(name, next as PathValue<T, Path<T>>, { shouldDirty: true });
    form.clearErrors(name);
  }

  function pick(file: File) {
    const problem = artFileProblem(file);
    if (problem !== null) {
      setError(problem);
      return;
    }
    latestPick.current += 1;
    const pickId = latestPick.current;
    setError(null);
    setLocalUrl(URL.createObjectURL(file));
    void upload.mutateAsync(file).then(
      (artKey) => {
        if (pickId === latestPick.current) setKey(artKey);
      },
      (failure: unknown) => {
        if (pickId !== latestPick.current) return;
        setLocalUrl(null);
        setError(failure instanceof ArtUploadError ? failure.message : errorMessage(failure));
      },
    );
  }

  function remove() {
    latestPick.current += 1;
    setLocalUrl(null);
    setError(null);
    setKey(null);
  }

  const savedUrl = key !== null && key === saved?.key ? saved.url : null;
  return {
    previewUrl: localUrl ?? savedUrl,
    hasArt: key !== null || localUrl !== null,
    uploading: upload.isPending,
    error,
    pick,
    remove,
  };
}

/** Why the browser refuses a file before any request, or null when it may be uploaded. */
export function artFileProblem(file: File): string | null {
  if (!ART_CONTENT_TYPES.includes(file.type)) return "Use a PNG, JPEG or WebP image.";
  if (file.size > ART_MAX_BYTES) {
    return `The image is larger than ${ART_MAX_BYTES / (1024 * 1024)} MB. Use a smaller one.`;
  }
  return null;
}
