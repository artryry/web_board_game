import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { addDeck, contentStore, SYSTEM_ORIGIN_IDS } from "@/test/contentStore";
import { logged } from "@/test/logCapture";
import { renderApp, saveSession } from "@/test/renderApp";

const CODE = "ABCDEFGHJK";

// The dialog is opened from the deck list here; the card library's groups use the same one.
async function openShareDialog(shareCode: string | null = null) {
  addDeck("Embers", SYSTEM_ORIGIN_IDS.volcano, [], shareCode);
  saveSession();
  const view = renderApp("/decks");
  await view.user.click(await screen.findByRole("button", { name: "Share Embers" }));
  return { ...view, dialog: screen.getByRole("dialog", { name: "Share Embers" }) };
}

describe("ShareDialog", () => {
  it("creates a link, and the list marks the deck as shared", async () => {
    const { user, dialog } = await openShareDialog();
    expect(dialog).toHaveTextContent("Anyone with the link can preview it and import a copy.");

    await user.click(within(dialog).getByRole("button", { name: "Create link" }));

    const code = await waitFor(() => {
      const stored = contentStore.decks[0]?.shareCode;
      expect(stored).toEqual(expect.any(String));
      return stored ?? "";
    });
    expect(await within(dialog).findByText(code)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Link")).toHaveValue(
      `${window.location.origin}/share/${code}`,
    );
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(await screen.findByText("Shared")).toBeInTheDocument();
  });

  it("shows an existing code as soon as it opens", async () => {
    const { dialog } = await openShareDialog(CODE);

    expect(within(dialog).getByText(CODE)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Create link" })).not.toBeInTheDocument();
  });

  it("copies the link", async () => {
    const { user, dialog } = await openShareDialog(CODE);

    await user.click(within(dialog).getByRole("button", { name: "Copy link" }));

    expect(within(dialog).getByRole("status")).toHaveTextContent("Copied");
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/share/${CODE}`);
  });

  it("selects the link for copying by hand when the clipboard fails, and logs it", async () => {
    const { user, dialog } = await openShareDialog(CODE);
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValue(new Error("Write permission denied"));

    await user.click(within(dialog).getByRole("button", { name: "Copy link" }));

    expect(within(dialog).getByRole("status")).toHaveTextContent("copy it by hand");
    const link = within(dialog).getByLabelText<HTMLInputElement>("Link");
    expect(link.selectionStart).toBe(0);
    expect(link.selectionEnd).toBe(link.value.length);
    const [entry] = logged("share.copy_failed");
    expect(entry?.level).toBe("warn");
    expect(entry?.fields).toEqual({ kind: "deck" });
    writeText.mockRestore();
  });

  it("revokes the code after asking, and offers a new link", async () => {
    const { user, dialog } = await openShareDialog(CODE);

    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));
    expect(dialog).toHaveTextContent("The link stops working. Sharing again makes a new code.");
    await user.click(within(dialog).getByRole("button", { name: "Revoke link" }));

    expect(await within(dialog).findByRole("button", { name: "Create link" })).toBeInTheDocument();
    expect(contentStore.decks[0]?.shareCode).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByText("Shared")).not.toBeInTheDocument();
    });
  });
});
