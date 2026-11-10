import { isRecord } from "@/api/errors";

import { humanize } from "./humanize";

// The JSON Schema subset the backend promises for module params (tests/engine/test_modules.py):
// inline schemas only, with bounded integers, numbers, booleans, string enums and arrays of string
// enums. Anything else becomes an `unsupported` field, which the form shows as an error.

interface FieldBase {
  name: string;
  title: string;
}

export type SchemaField =
  | (FieldBase & {
      kind: "integer" | "number";
      min: number | undefined;
      max: number | undefined;
      default: number;
    })
  | (FieldBase & { kind: "boolean"; default: boolean })
  | (FieldBase & { kind: "enum"; options: string[]; default: string })
  | (FieldBase & {
      /** `enum-checkboxes` for `uniqueItems`, otherwise a list of selects. */
      kind: "enum-checkboxes" | "enum-list";
      options: string[];
      minItems: number;
      maxItems: number | undefined;
      default: string[];
    })
  | (FieldBase & { kind: "unsupported"; reason: string });

export function parseSchema(schema: Readonly<Record<string, unknown>>): SchemaField[] {
  const properties = schema.properties;
  if (!isRecord(properties)) return [];
  return Object.entries(properties).map(([name, property]) => parseProperty(name, property));
}

/** Params filled from the schema's defaults, for a module that was just added. */
export function defaultParams(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const field of parseSchema(schema)) {
    if (field.kind !== "unsupported") params[field.name] = field.default;
  }
  return params;
}

/** Params as "Title value" pairs, for a module's badge: "Applies to Own origin, HP 1". */
export function describeParams(
  schema: Readonly<Record<string, unknown>>,
  params: Readonly<Record<string, unknown>>,
): string {
  return parseSchema(schema)
    .filter((field) => field.kind !== "unsupported")
    .map((field) => `${field.title} ${describeValue(params[field.name])}`)
    .join(", ");
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return humanize(value);
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "–";
  if (Array.isArray(value)) return value.map(describeValue).join(" / ");
  return "–";
}

function parseProperty(name: string, property: unknown): SchemaField {
  if (!isRecord(property)) return unsupported(name, humanize(name), "it has no schema");
  const base = {
    name,
    title: typeof property.title === "string" ? property.title : humanize(name),
  };

  switch (property.type) {
    case "integer":
    case "number": {
      const min = numberOrUndefined(property.minimum);
      const max = numberOrUndefined(property.maximum);
      // The contract bounds every integer, so the form can always offer a valid range.
      if (property.type === "integer" && (min === undefined || max === undefined)) {
        return unsupported(name, base.title, "an integer needs a minimum and a maximum");
      }
      const fallback = min ?? 0;
      return {
        ...base,
        kind: property.type,
        min,
        max,
        default: numberOrUndefined(property.default) ?? fallback,
      };
    }
    case "boolean":
      return { ...base, kind: "boolean", default: property.default === true };
    case "string": {
      const options = stringList(property.enum);
      if (options === null || options.length === 0) {
        return unsupported(name, base.title, "a text setting needs a list of choices");
      }
      const first = options[0] ?? "";
      const chosen = property.default;
      return {
        ...base,
        kind: "enum",
        options,
        default: typeof chosen === "string" && options.includes(chosen) ? chosen : first,
      };
    }
    case "array":
      return parseEnumArray(name, base, property);
    default:
      return unsupported(name, base.title, `the type ${JSON.stringify(property.type)}`);
  }
}

function parseEnumArray(
  name: string,
  base: FieldBase,
  property: Record<string, unknown>,
): SchemaField {
  const items = property.items;
  const options = isRecord(items) ? stringList(items.enum) : null;
  if (options === null || options.length === 0) {
    return unsupported(name, base.title, "a list needs a list of choices");
  }
  const minItems = numberOrUndefined(property.minItems) ?? 0;
  const chosen = stringList(property.default)?.filter((value) => options.includes(value));
  return {
    ...base,
    kind: property.uniqueItems === true ? "enum-checkboxes" : "enum-list",
    options,
    minItems,
    maxItems: numberOrUndefined(property.maxItems),
    default: chosen ?? options.slice(0, minItems),
  };
}

function unsupported(name: string, title: string, reason: string): SchemaField {
  return { name, title, kind: "unsupported", reason };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const list: unknown[] = value;
  return list.every((item) => typeof item === "string") ? list : null;
}
