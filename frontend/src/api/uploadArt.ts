import { api } from "./client";
import { unwrap } from "./errors";

export type ArtKind = "card" | "origin";

/** The upload to storage failed after the API signed it. */
export class ArtUploadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArtUploadError";
  }
}

/**
 * Uploads card art or an origin background, and returns the `art_key` to save with the card or
 * origin. The API signs a PUT URL, then the file goes straight to R2. R2 is another origin, so
 * the request carries no bearer token, and its Content-Type must be the one that was signed.
 */
export async function uploadArt(kind: ArtKind, file: File): Promise<string> {
  const body = { content_type: file.type, size: file.size };
  const ticket = unwrap(
    kind === "card"
      ? await api.POST("/api/uploads/card-art", { body })
      : await api.POST("/api/uploads/origin-art", { body }),
  );

  let response: Response;
  try {
    response = await fetch(ticket.upload_url, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    });
  } catch (error) {
    // A network error, or the bucket refusing this origin (its CORS rule).
    throw new ArtUploadError("Couldn't upload the image. Check your connection and try again.", {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new ArtUploadError(`The image upload failed (HTTP ${response.status}). Try again.`);
  }
  return ticket.art_key;
}
