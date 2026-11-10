import { useFormContext, useFormState } from "react-hook-form";

/** The error message of one field of the surrounding form, by its path (`abilities.0.params.amount`). */
export function useFieldError(path: string): string | undefined {
  const { control, getFieldState } = useFormContext();
  const formState = useFormState({ control, name: path });
  return getFieldState(path, formState).error?.message;
}
