import { useFormContext } from "react-hook-form";

import { SelectField } from "@/ui/SelectField";
import { TextField } from "@/ui/TextField";

import { EnumCheckboxesParam, EnumListParam } from "./EnumArrayParams";
import { humanize } from "./humanize";
import { parseSchema, type SchemaField } from "./schemaFields";
import { useFieldError } from "./useFieldError";

interface SchemaFormProps {
  /** A catalog module's `params_schema`. */
  schema: Readonly<Record<string, unknown>>;
  /** Where the params live in the surrounding form, for example `abilities.0.params`. */
  name: string;
}

/**
 * A module's settings form, built from its JSON Schema inside the editor's own form, so the params
 * are part of the editor's state. The client checks only the schema's bounds; the server checks
 * the rest. A schema without properties renders nothing.
 */
export function SchemaForm({ schema, name }: SchemaFormProps) {
  const fields = parseSchema(schema);
  if (fields.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((field) => (
        <ParamField key={field.name} field={field} path={`${name}.${field.name}`} />
      ))}
    </div>
  );
}

function ParamField({ field, path }: { field: SchemaField; path: string }) {
  switch (field.kind) {
    case "integer":
    case "number":
      return <NumberParam field={field} path={path} />;
    case "boolean":
      return <BooleanParam field={field} path={path} />;
    case "enum":
      return <EnumParam field={field} path={path} />;
    case "enum-checkboxes":
      return <EnumCheckboxesParam field={field} path={path} />;
    case "enum-list":
      return <EnumListParam field={field} path={path} />;
    case "unsupported":
      // Skipping it would save the module without a setting it needs, so say what is wrong.
      return (
        <p role="alert" className="text-sm text-danger sm:col-span-2">
          Can't show the setting “{field.title}”: {field.reason}.
        </p>
      );
  }
}

type FieldOf<K extends SchemaField["kind"]> = Extract<SchemaField, { kind: K }>;

function NumberParam({ field, path }: { field: FieldOf<"integer" | "number">; path: string }) {
  const { register } = useFormContext();
  const error = useFieldError(path);
  const whole = field.kind === "integer";
  return (
    <TextField
      label={field.title}
      type="number"
      inputMode={whole ? "numeric" : "decimal"}
      step={whole ? 1 : "any"}
      min={field.min}
      max={field.max}
      error={error}
      {...register(path, {
        valueAsNumber: true,
        required: `Enter ${field.title}.`,
        min:
          field.min === undefined
            ? undefined
            : { value: field.min, message: `Use ${field.min} or more.` },
        max:
          field.max === undefined
            ? undefined
            : { value: field.max, message: `Use ${field.max} or less.` },
        validate: whole
          ? (value: unknown) => Number.isInteger(value) || "Use a whole number."
          : undefined,
      })}
    />
  );
}

function BooleanParam({ field, path }: { field: FieldOf<"boolean">; path: string }) {
  const { register } = useFormContext();
  return (
    <label className="flex items-center gap-2 self-end py-2">
      <input type="checkbox" className="size-4 accent-accent" {...register(path)} />
      {field.title}
    </label>
  );
}

function EnumParam({ field, path }: { field: FieldOf<"enum">; path: string }) {
  const { register } = useFormContext();
  const error = useFieldError(path);
  return (
    <SelectField
      label={field.title}
      error={error}
      {...register(path, { required: `Choose ${field.title}.` })}
    >
      {field.options.map((option) => (
        <option key={option} value={option}>
          {humanize(option)}
        </option>
      ))}
    </SelectField>
  );
}
