import { useFormContext, useFormState } from "react-hook-form";

import { useOutsideFieldError } from "./outsideFieldErrors";

/**
 * The error message of one field of the surrounding form, by its path (`abilities.0.params.amount`):
 * the form's own check first, then an outside one (`OutsideFieldErrors`).
 */
export function useFieldError(path: string): string | undefined {
  const { control, getFieldState } = useFormContext();
  const formState = useFormState({ control, name: path });
  const outside = useOutsideFieldError(path);
  return getFieldState(path, formState).error?.message ?? outside;
}
