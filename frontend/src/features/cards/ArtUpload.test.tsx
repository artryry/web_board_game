import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { ART_MAX_BYTES } from "@/api/bounds";
import { R2_TEST_ORIGIN } from "@/test/contentHandlers";
import { addCard, ART_PUBLIC_ORIGIN, contentStore, lastBody } from "@/test/contentStore";
import { renderApp, saveSession } from "@/test/renderApp";
import { server } from "@/test/server";

function image(name: string, type: string, size = 1024): File {
  const file = new File([new Uint8Array(8)], name, { type });
  // The size is what the browser reports; no need to hold megabytes in memory.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function uploadRequests() {
  return contentStore.requests.filter((request) => request.path.startsWith("/api/uploads"));
}

async function openNewCard() {
  saveSession();
  const view = renderApp("/cards/new");
  await screen.findByRole("heading", { name: "New card" });
  await view.user.type(screen.getByLabelText("Name"), "Painted");
  return view;
}

describe("ArtUpload", () => {
  it("refuses a wrong type or too large a file before any request", async () => {
    await openNewCard();
    // user-event drops files that don't match `accept`; a user can still pick "All files".
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(screen.getByLabelText("Card art"), image("cat.gif", "image/gif"));
    expect(await screen.findByText("Use a PNG, JPEG or WebP image.")).toBeInTheDocument();

    await user.upload(
      screen.getByLabelText("Card art"),
      image("huge.png", "image/png", ART_MAX_BYTES + 1),
    );
    expect(await screen.findByText(/larger than 2 MB/)).toBeInTheDocument();
    expect(uploadRequests()).toHaveLength(0);
  });

  it("signs the upload, puts the file with its type, and saves the art_key with the card", async () => {
    const { user } = await openNewCard();

    await user.upload(screen.getByLabelText("Card art"), image("wolf.png", "image/png"));

    expect(screen.getByAltText("Card art preview")).toHaveAttribute(
      "src",
      expect.stringMatching(/^blob:/),
    );
    await waitFor(() => {
      expect(screen.queryByText("Uploading…")).not.toBeInTheDocument();
    });
    expect(lastBody("POST", "/api/uploads/card-art")).toEqual({
      content_type: "image/png",
      size: 1024,
    });
    const [key] = [...contentStore.stored];
    expect(key).toMatch(/^card\/user\/.+\.png$/);

    await user.click(screen.getByRole("button", { name: "Create card" }));
    await waitFor(() => {
      expect(lastBody("POST", "/api/cards")).toMatchObject({ name: "Painted", art_key: key });
    });
  });

  it("shows a failed upload at the uploader and keeps the card without art", async () => {
    server.use(
      http.put(`${R2_TEST_ORIGIN}/upload/*`, () => new HttpResponse(null, { status: 500 })),
    );
    const { user } = await openNewCard();

    await user.upload(screen.getByLabelText("Card art"), image("wolf.png", "image/png"));

    expect(
      await screen.findByText("The image upload failed (HTTP 500). Try again."),
    ).toBeInTheDocument();
    expect(screen.queryByAltText("Card art preview")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create card" }));
    await waitFor(() => {
      expect(lastBody("POST", "/api/cards")).toMatchObject({ art_key: null });
    });
  });

  it("shows the saved art, and Remove sends null", async () => {
    contentStore.stored.add("card/user/old.png");
    const wolf = addCard({ name: "Wolf", art_key: "card/user/old.png" });
    saveSession();
    const { user } = renderApp(`/cards/${wolf.id}`);
    await screen.findByRole("heading", { name: "Edit Wolf" });

    expect(screen.getByAltText("Card art preview")).toHaveAttribute(
      "src",
      `${ART_PUBLIC_ORIGIN}/card/user/old.png`,
    );
    await user.click(screen.getByRole("button", { name: "Remove card art" }));
    expect(screen.queryByAltText("Card art preview")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(lastBody("PATCH", `/api/cards/${wolf.id}`)).toMatchObject({ art_key: null });
    });
  });

  it("uploads an origin background the same way", async () => {
    saveSession();
    const { user } = renderApp("/origins/new");
    await screen.findByRole("heading", { name: "New origin" });

    await user.type(screen.getByLabelText("Name"), "Swamp");
    await user.upload(screen.getByLabelText("Background image"), image("bog.webp", "image/webp"));
    await waitFor(() => {
      expect(screen.queryByText("Uploading…")).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Create origin" }));

    const [key] = [...contentStore.stored];
    expect(key).toMatch(/^origin\/user\/.+\.webp$/);
    await waitFor(() => {
      expect(lastBody("POST", "/api/origins")).toMatchObject({ background_art_key: key });
    });
  });
});
