import type { ReactNode } from "react";
import { FormProvider, useForm, type FieldValues } from "react-hook-form";

interface FormHarnessProps {
  defaultValues: FieldValues;
  onSubmit: (values: FieldValues) => void;
  children: ReactNode;
}

/** A React Hook Form with a Submit button, around the form parts under test. */
export function FormHarness({ defaultValues, onSubmit, children }: FormHarnessProps) {
  const form = useForm({ defaultValues, mode: "onTouched" });
  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit((values) => {
            onSubmit(values);
          })(event);
        }}
      >
        {children}
        <button type="submit">Submit</button>
      </form>
    </FormProvider>
  );
}
