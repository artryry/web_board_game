import { render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { FieldValues } from "react-hook-form";
import { vi } from "vitest";

import { FormHarness } from "./FormHarness";

/**
 * Renders form parts (SchemaForm, ModuleListField) inside a React Hook Form with a Submit
 * button. `onSubmit` receives the values when every field is valid.
 */
export function renderWithForm(ui: ReactNode, defaultValues: FieldValues) {
  const onSubmit = vi.fn<(values: FieldValues) => void>();
  const user = userEvent.setup();
  const view = render(
    <FormHarness defaultValues={defaultValues} onSubmit={onSubmit}>
      {ui}
    </FormHarness>,
  );
  return { ...view, onSubmit, user };
}

/** The values of the last valid submit. */
export function submitted(onSubmit: ReturnType<typeof renderWithForm>["onSubmit"]): FieldValues {
  const values = onSubmit.mock.calls.at(-1)?.[0];
  if (values === undefined) throw new Error("The form wasn't submitted with valid values");
  return values;
}
