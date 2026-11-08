import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { ApiError } from "@/api/errors";

// Server codes that belong to one input rather than to the whole form.
const FIELD_OF_CODE: Readonly<Record<string, string>> = {
  username_taken: "username",
  email_taken: "email",
};

/**
 * Shows a failed submit on the form: on its field when the error names one of `fields`,
 * otherwise as one message for the whole form (`errors.root.server`).
 */
export function showServerError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): void {
  if (!(error instanceof ApiError)) {
    setError("root.server", { message: "Can't reach the server. Try again." });
    return;
  }

  const ownField = (name: string | undefined) => fields.find((field) => field === name);

  const codeField = ownField(FIELD_OF_CODE[error.code]);
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
