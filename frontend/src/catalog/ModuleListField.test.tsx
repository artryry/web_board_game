import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CATALOG } from "@/test/catalogFixture";
import { renderWithForm, submitted } from "@/test/renderWithForm";

import { ModuleListField } from "./ModuleListField";
import type { ModuleRef } from "./useCatalog";

function renderList(effects: ModuleRef[] = []) {
  return renderWithForm(
    <ModuleListField
      name="field_effects"
      label="Field effects"
      noun="field effect"
      modules={CATALOG.field_effects}
      max={3}
    />,
    { field_effects: effects },
  );
}

function addSelect() {
  return screen.getByLabelText("Add field effect");
}

describe("ModuleListField", () => {
  it("adds a module with its schema's defaults", async () => {
    const { onSubmit, user } = renderList();

    await user.selectOptions(addSelect(), "Stat bonus");
    expect(screen.getByText("Changes creature stats.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(submitted(onSubmit)).toEqual({
      field_effects: [{ key: "stat_bonus", params: { applies_to: "own_origin", hp: 0, dmg: 0 } }],
    });
  });

  it("offers each module once and stops at the limit", async () => {
    const { user } = renderList();

    await user.selectOptions(addSelect(), "Stat bonus");
    expect(within(addSelect()).queryByRole("option", { name: "Stat bonus" })).toBeNull();

    await user.selectOptions(addSelect(), "Free move");
    await user.selectOptions(addSelect(), "Section HP bonus");
    expect(addSelect()).toBeDisabled();
    expect(screen.getByText("(3 of 3)")).toBeInTheDocument();
  });

  it("removes a module", async () => {
    const { onSubmit, user } = renderList([
      { key: "free_move", params: {} },
      { key: "section_hp_bonus", params: { amount: 4 } },
    ]);

    await user.click(screen.getByRole("button", { name: "Remove Free move" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(submitted(onSubmit)).toEqual({
      field_effects: [{ key: "section_hp_bonus", params: { amount: 4 } }],
    });
  });

  it("shows a module the catalog doesn't know, so it can be removed", () => {
    renderList([{ key: "retired_effect", params: {} }]);

    expect(
      screen.getByText("Unknown module “retired_effect”", { selector: "p" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Unknown module “retired_effect”" }),
    ).toBeInTheDocument();
  });
});
