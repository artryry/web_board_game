/**
 * React Hook Form rules for a whole number within bounds, read as a number. An empty input fails
 * `required`, so it never reaches the server as NaN.
 */
export function wholeNumber(label: string, min: number, max: number) {
  return {
    valueAsNumber: true,
    required: `Enter ${label}.`,
    min: { value: min, message: `Use ${min} or more.` },
    max: { value: max, message: `Use ${max} or less.` },
    validate: (value: unknown) => Number.isInteger(value) || "Use a whole number.",
  } as const;
}
