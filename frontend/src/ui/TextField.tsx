import { useId, type ComponentProps } from "react";

type TextFieldProps = ComponentProps<"input"> & {
  label: string;
  error?: string | undefined;
};

/** A labelled input. Its error text is linked to the input, so screen readers announce it. */
export function TextField({ label, error, id, className = "", ...inputProps }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hasError = error !== undefined && error !== "";

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : undefined}
        className={`rounded-md border bg-bg px-3 py-2 text-text placeholder:text-text-muted ${hasError ? "border-danger" : "border-border-strong"} ${className}`}
        {...inputProps}
      />
      {hasError && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
