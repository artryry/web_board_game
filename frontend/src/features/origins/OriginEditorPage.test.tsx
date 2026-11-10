import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { addOrigin, lastBody, SYSTEM_ORIGIN_IDS } from "@/test/contentStore";
import { renderApp, saveSession } from "@/test/renderApp";

async function openEditor(path: string, heading: string) {
  saveSession();
  const view = renderApp(path);
  await screen.findByRole("heading", { name: heading });
  return view;
}

describe("OriginEditorPage", () => {
  it("creates an origin with a field effect while the preview follows the form", async () => {
    const { user, router } = await openEditor("/origins/new", "New origin");

    await user.type(screen.getByLabelText("Name"), "Swamp");
    await user.click(screen.getByLabelText("Black"));
    await user.click(screen.getByLabelText("Droplet"));
    await user.selectOptions(screen.getByLabelText("Add field effect"), "Stat bonus");
    await user.clear(screen.getByLabelText("HP"));
    await user.type(screen.getByLabelText("HP"), "1");

    const preview = screen.getByRole("region", { name: "Preview" });
    expect(within(preview).getByText("Swamp")).toBeInTheDocument();
    expect(within(preview).getByText("Stat bonus")).toBeInTheDocument();
    expect(within(preview).getByText("Applies To Own origin, HP 1, DMG 0")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create origin" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/origins");
    });
    expect(lastBody("POST", "/api/origins")).toEqual({
      name: "Swamp",
      color: "black",
      icon: "droplet",
      field_effects: [{ key: "stat_bonus", params: { applies_to: "own_origin", hp: 1, dmg: 0 } }],
      background_art_key: null,
    });
    expect(await screen.findByRole("heading", { name: "Swamp" })).toBeInTheDocument();
  });

  it("takes at most 3 field effects, each once", async () => {
    const { user } = await openEditor("/origins/new", "New origin");
    const add = screen.getByLabelText("Add field effect");

    await user.selectOptions(add, "Stat bonus");
    expect(within(add).queryByRole("option", { name: "Stat bonus" })).toBeNull();
    await user.selectOptions(add, "Free move");
    await user.selectOptions(add, "Section HP bonus");

    expect(add).toBeDisabled();
  });

  it("shows a system origin read-only, and Duplicate fills in a new origin", async () => {
    const { user, router } = await openEditor(`/origins/${SYSTEM_ORIGIN_IDS.forest}`, "Forest");

    expect(screen.getByText("Template")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("HP")).toBeDisabled();
    expect(screen.queryByLabelText("Add field effect")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Duplicate" }));

    expect(await screen.findByRole("heading", { name: "Duplicate Forest" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Forest copy");
    await user.click(screen.getByRole("button", { name: "Create origin" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/origins");
    });
    expect(lastBody("POST", "/api/origins")).toMatchObject({
      name: "Forest copy",
      color: "bluish_green",
      icon: "leaf",
      field_effects: [{ key: "stat_bonus", params: { applies_to: "own_origin", hp: 1, dmg: 0 } }],
    });
  });

  it("saves the whole form when an own origin is edited", async () => {
    const swamp = addOrigin({
      name: "Swamp",
      color: "black",
      icon: "droplet",
      field_effects: [{ key: "section_hp_bonus", params: { amount: 5 } }],
    });
    const { user } = await openEditor(`/origins/${swamp.id}`, "Edit Swamp");

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Marsh");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(lastBody("PATCH", `/api/origins/${swamp.id}`)).toEqual({
        name: "Marsh",
        color: "black",
        icon: "droplet",
        field_effects: [{ key: "section_hp_bonus", params: { amount: 5 } }],
        background_art_key: null,
      });
    });
  });

  it("says when the origin doesn't exist", async () => {
    saveSession();
    renderApp("/origins/30000000-0000-4000-8000-000000000000");
    expect(await screen.findByRole("alert")).toHaveTextContent("This origin doesn't exist");
  });
});
