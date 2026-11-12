import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { addCard, addDeck, addOrigin, contentStore } from "@/test/contentStore";
import { renderApp, saveSession } from "@/test/renderApp";

describe("OriginListPage", () => {
  it("lists the templates with Duplicate, then the user's own origins", async () => {
    addOrigin({ name: "Swamp" });
    saveSession();
    renderApp("/origins");

    const templates = await screen.findByRole("region", { name: "Templates" });
    expect(within(templates).getByRole("link", { name: "Duplicate Forest" })).toHaveAttribute(
      "href",
      expect.stringContaining("/origins/new?from="),
    );
    expect(within(templates).queryByRole("button", { name: /^Delete/ })).toBeNull();

    const own = screen.getByRole("region", { name: "My origins" });
    expect(within(own).getByRole("link", { name: "Edit Swamp" })).toBeInTheDocument();
    expect(within(own).getByRole("button", { name: "Delete Swamp" })).toBeInTheDocument();
  });

  it("lists the cards and decks that still use an origin it can't delete", async () => {
    const swamp = addOrigin({ name: "Swamp" });
    const troll = addCard({ name: "Bog troll", origin_id: swamp.id });
    const deck = addDeck("Swamp rush", swamp.id, [troll.id]);
    saveSession();
    const { user } = renderApp("/origins");

    await user.click(await screen.findByRole("button", { name: "Delete Swamp" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Swamp?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await within(dialog).findByRole("link", { name: "Bog troll" })).toHaveAttribute(
      "href",
      `/cards/${troll.id}`,
    );
    expect(within(dialog).getByRole("link", { name: "Swamp rush" })).toHaveAttribute(
      "href",
      `/decks/${deck.id}`,
    );
    expect(contentStore.origins.some((origin) => origin.id === swamp.id)).toBe(true);
  });

  it("deletes an origin nothing uses", async () => {
    addOrigin({ name: "Swamp" });
    saveSession();
    const { user } = renderApp("/origins");

    await user.click(await screen.findByRole("button", { name: "Delete Swamp" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete Swamp?" })).getByRole("button", {
        name: "Delete",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Delete Swamp" })).not.toBeInTheDocument();
  });
});
