import { useController, useFormContext } from "react-hook-form";

import { Button } from "@/ui/Button";
import { SelectField } from "@/ui/SelectField";

import { humanize } from "./humanize";
import type { SchemaField } from "./schemaFields";

type EnumArrayField = Extract<SchemaField, { kind: "enum-checkboxes" | "enum-list" }>;

interface EnumArrayParamProps {
  field: EnumArrayField;
  path: string;
}

/** An array of choices with `uniqueItems`: one checkbox per choice, kept in the schema's order. */
export function EnumCheckboxesParam({ field, path }: EnumArrayParamProps) {
  const { input, chosen, error } = useEnumArray(field, path);

  function toggle(option: string, checked: boolean) {
    input.onChange(
      checked
        ? field.options.filter((value) => value === option || chosen.includes(value))
        : chosen.filter((value) => value !== option),
    );
  }

  return (
    <fieldset className="sm:col-span-2">
      <legend className="text-sm font-medium">{field.title}</legend>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {field.options.map((option) => (
          <label key={option} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={chosen.includes(option)}
              onChange={(event) => {
                toggle(option, event.target.checked);
              }}
              onBlur={input.onBlur}
              className="size-4 accent-accent"
            />
            {humanize(option)}
          </label>
        ))}
      </div>
      {error !== undefined && <p className="mt-1 text-sm text-danger">{error}</p>}
    </fieldset>
  );
}

/** An array of choices that may repeat: a list of selects within `minItems` and `maxItems`. */
export function EnumListParam({ field, path }: EnumArrayParamProps) {
  const { input, chosen, error } = useEnumArray(field, path);
  const canAdd = field.maxItems === undefined || chosen.length < field.maxItems;

  return (
    <fieldset className="sm:col-span-2">
      <legend className="text-sm font-medium">{field.title}</legend>
      <ol className="mt-1 flex flex-col gap-2">
        {chosen.map((value, index) => (
          // The position is the identity here: the same choice may appear twice.
          <li key={index} className="flex items-end gap-2">
            <SelectField
              label={`${field.title} ${index + 1}`}
              value={value}
              onChange={(event) => {
                input.onChange(chosen.map((old, i) => (i === index ? event.target.value : old)));
              }}
              onBlur={input.onBlur}
              className="flex-1"
            >
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {humanize(option)}
                </option>
              ))}
            </SelectField>
            {chosen.length > field.minItems && (
              <Button
                variant="secondary"
                onClick={() => {
                  input.onChange(chosen.filter((_, i) => i !== index));
                }}
              >
                Remove{" "}
                <span className="sr-only">
                  {field.title} {index + 1}
                </span>
              </Button>
            )}
          </li>
        ))}
      </ol>
      {canAdd && (
        <Button
          variant="secondary"
          className="mt-2"
          onClick={() => {
            input.onChange([...chosen, field.options[0] ?? ""]);
          }}
        >
          Add <span className="sr-only">{field.title}</span>
        </Button>
      )}
      {error !== undefined && <p className="mt-1 text-sm text-danger">{error}</p>}
    </fieldset>
  );
}

function useEnumArray(field: EnumArrayField, path: string) {
  const { control } = useFormContext();
  const { field: input, fieldState } = useController({
    control,
    name: path,
    rules: { validate: (value: unknown) => countProblem(stringArray(value).length, field) ?? true },
  });
  return { input, chosen: stringArray(input.value), error: fieldState.error?.message };
}

function countProblem(count: number, field: EnumArrayField): string | undefined {
  if (count < field.minItems) return `Choose at least ${field.minItems}.`;
  if (field.maxItems !== undefined && count > field.maxItems) {
    return `Choose at most ${field.maxItems}.`;
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const list: unknown[] = value;
  return list.filter((item): item is string => typeof item === "string");
}
