import { useId, type ComponentProps } from "react";

type SelectFieldProps = ComponentProps<"select"> & {
  label: string;
  error?: string | undefined;
};

/** A labelled select. Its error text is linked to the select, so screen readers announce it. */
export function SelectField({
  label,
  error,
  id,
  className = "",
  children,
  ...selectProps
}: SelectFieldProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const errorId = `${selectId}-error`;
  const hasError = error !== undefined && error !== "";

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={selectId} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={selectId}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : undefined}
        className={`rounded-md border bg-bg px-3 py-2 text-text ${hasError ? "border-danger" : "border-border-strong"}`}
        {...selectProps}
      >
        {children}
      </select>
      {hasError && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
