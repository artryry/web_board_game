import { useMutation } from "@tanstack/react-query";

import { uploadArt, type ArtKind } from "@/api/uploadArt";

/** Uploads one image and resolves with its `art_key`. Nothing is cached: the key is saved later. */
export function useArtUpload(kind: ArtKind) {
  return useMutation({ mutationFn: (file: File) => uploadArt(kind, file) });
}
