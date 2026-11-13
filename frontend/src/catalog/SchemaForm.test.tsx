import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CATALOG } from "@/test/catalogFixture";
import { renderWithForm, submitted } from "@/test/renderWithForm";

import { OutsideFieldErrors } from "./outsideFieldErrors";
import { SchemaForm } from "./SchemaForm";
import { defaultParams } from "./schemaFields";
import { findModule } from "./useCatalog";

function schemaOf(key: string): Record<string, unknown> {
  const module = findModule(CATALOG.field_effects, key);
  if (module === undefined) throw new Error(`No field effect ${key} in the fixture`);
  return module.params_schema;
}

function renderSchema(key: string) {
  const schema = schemaOf(key);
  return renderWithForm(<SchemaForm schema={schema} name="params" />, {
    params: defaultParams(schema),
  });
}

describe("SchemaForm", () => {
  it("renders integers and enums with their titles and defaults", () => {
    renderSchema("stat_bonus");

    expect(screen.getByLabelText("Applies To")).toHaveValue("own_origin");
    expect(screen.getByRole("option", { name: "Own origin" })).toBeInTheDocument();
    expect(screen.getByLabelText("HP")).toHaveValue(0);
    expect(screen.getByLabelText("HP")).toHaveAttribute("max", "2");
  });

  it("sends numbers as numbers and enums as their keys", async () => {
    const { onSubmit, user } = renderSchema("stat_bonus");

    await user.selectOptions(screen.getByLabelText("Applies To"), "Enemy");
    await user.clear(screen.getByLabelText("DMG"));
    await user.type(screen.getByLabelText("DMG"), "2");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(submitted(onSubmit)).toEqual({ params: { applies_to: "enemy", hp: 0, dmg: 2 } });
  });

  it("checks an integer's bounds before submitting", async () => {
    const { onSubmit, user } = renderSchema("stat_bonus");

    await user.clear(screen.getByLabelText("HP"));
    await user.type(screen.getByLabelText("HP"), "5");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText("Use 2 or less.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders numbers, booleans and both kinds of enum arrays", async () => {
    const { onSubmit, user } = renderSchema("test_every_type");

    expect(screen.getByLabelText("Weight")).toHaveValue(1.5);
    expect(screen.getByLabelText("Enabled")).toBeChecked();
    const tags = screen.getByRole("group", { name: "Tags" });
    expect(within(tags).getByLabelText("Fire")).toBeChecked();
    expect(screen.getByLabelText("Sequence 1")).toHaveValue("draw");

    await user.click(screen.getByLabelText("Enabled"));
    await user.click(within(tags).getByLabelText("Earth"));
    await user.click(screen.getByRole("button", { name: "Add Sequence" }));
    await user.selectOptions(screen.getByLabelText("Sequence 2"), "Play");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(submitted(onSubmit)).toEqual({
      params: { weight: 1.5, enabled: false, tags: ["fire", "earth"], sequence: ["draw", "play"] },
    });
  });

  it("keeps an enum array within minItems and maxItems", async () => {
    const { onSubmit, user } = renderSchema("test_every_type");
    const tags = screen.getByRole("group", { name: "Tags" });

    await user.click(within(tags).getByLabelText("Water"));
    await user.click(within(tags).getByLabelText("Earth"));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Choose at most 2.")).toBeInTheDocument();

    // The list of selects can't drop below one item.
    expect(screen.queryByRole("button", { name: "Remove Sequence 1" })).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders nothing for a schema without properties", () => {
    const { container } = renderSchema("free_move");
    expect(container.querySelector("form")?.children).toHaveLength(1);
  });

  it("shows outside errors at their fields, after the form's own", async () => {
    const schema = schemaOf("test_every_type");
    const outside = new Map([
      ["params.weight", "Input should be less than or equal to 2"],
      ["params.tags", "Value error, tags must not repeat"],
    ]);
    const { user } = renderWithForm(
      <OutsideFieldErrors value={outside}>
        <SchemaForm schema={schema} name="params" />
      </OutsideFieldErrors>,
      { params: defaultParams(schema) },
    );

    expect(screen.getByLabelText("Weight")).toHaveAccessibleDescription(
      "Input should be less than or equal to 2",
    );
    expect(screen.getByRole("group", { name: "Tags" })).toHaveTextContent(
      "Value error, tags must not repeat",
    );

    await user.clear(screen.getByLabelText("Weight"));
    await user.tab();
    expect(screen.getByLabelText("Weight")).toHaveAccessibleDescription("Enter Weight.");
  });

  it("shows an error for a property it can't render", () => {
    renderSchema("test_unsupported");
    expect(screen.getByRole("alert")).toHaveTextContent(
      'Can\'t show the setting “Shape”: the type "object"',
    );
  });
});
