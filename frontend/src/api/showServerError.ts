import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { ApiError } from "./errors";

/**
 * Shows a failed submit on the form: on its field when the error belongs to one of `fields`,
 * otherwise as one message for the whole form (`errors.root.server`). An error belongs to a
 * field when `fieldOfCode` maps its code there (`group_name_taken` → `name`), or when FastAPI's
 * own 422 names the field.
 */
export function showServerError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
  fieldOfCode: Readonly<Record<string, string>> = {},
): void {
  if (!(error instanceof ApiError)) {
    setError("root.server", { message: "Can't reach the server. Try again." });
    return;
  }

  const ownField = (name: string | undefined) => fields.find((field) => field === name);

  const codeField = ownField(fieldOfCode[error.code]);
  if (codeField !== undefined) {
    setError(codeField, { type: "server", message: error.message }, { shouldFocus: true });
    return;
  }

  let shown = false;
  for (const [name, message] of Object.entries(error.fieldErrors)) {
    const field = ownField(name);
    if (field === undefined) continue;
    setError(field, { type: "server", message });
    shown = true;
  }
  if (!shown) setError("root.server", { message: error.message });
}
