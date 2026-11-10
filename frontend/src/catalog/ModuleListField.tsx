import { useFieldArray, useFormContext } from "react-hook-form";

import { Button } from "@/ui/Button";
import { SelectField } from "@/ui/SelectField";

import { SchemaForm } from "./SchemaForm";
import { defaultParams } from "./schemaFields";
import { findModule, type ModuleRef, type ModuleSpec } from "./useCatalog";

interface ModuleListFieldProps {
  /** The form's list of `{key, params}`, for example `abilities` or `field_effects`. */
  name: string;
  label: string;
  /** One item, as in "Add ability". */
  noun: string;
  modules: readonly ModuleSpec[];
  max: number;
  /** Shows the modules and their settings without the add and remove controls. */
  readOnly?: boolean;
}

type ModuleListValues = Record<string, ModuleRef[]>;

/**
 * The modules chosen for a card or an origin: each one at most once, up to `max`, each set up
 * with its `SchemaForm`. A module the catalog doesn't know any more can only be removed.
 */
export function ModuleListField({
  name,
  label,
  noun,
  modules,
  max,
  readOnly = false,
}: ModuleListFieldProps) {
  const { control } = useFormContext<ModuleListValues>();
  const { fields, append, remove } = useFieldArray<ModuleListValues>({ control, name });
  const chosen = new Set(fields.map((field) => field.key));
  const available = modules.filter((module) => !chosen.has(module.key));
  const full = fields.length >= max;

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-medium">
        {label}{" "}
        <span className="text-sm font-normal text-text-muted">
          ({fields.length} of {max})
        </span>
      </legend>
      {fields.length === 0 && <p className="text-sm text-text-muted">None yet.</p>}
      {fields.length > 0 && (
        <ul className="flex flex-col gap-3">
          {fields.map((field, index) => {
            const spec = findModule(modules, field.key);
            const title = spec?.name ?? `Unknown module “${field.key}”`;
            return (
              <li key={field.id} className="rounded-md border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{title}</p>
                    {spec !== undefined && (
                      <p className="text-sm text-text-muted">{spec.description}</p>
                    )}
                  </div>
                  {!readOnly && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        remove(index);
                      }}
                    >
                      Remove <span className="sr-only">{title}</span>
                    </Button>
                  )}
                </div>
                {spec !== undefined && (
                  <div className="mt-3">
                    <SchemaForm schema={spec.params_schema} name={`${name}.${index}.params`} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <SelectField
          label={`Add ${noun}`}
          value=""
          disabled={full || available.length === 0}
          onChange={(event) => {
            const spec = findModule(modules, event.target.value);
            if (spec === undefined) return;
            append(
              { key: spec.key, params: defaultParams(spec.params_schema) },
              { shouldFocus: false },
            );
          }}
        >
          <option value="">{full ? `At most ${max}` : "Choose one"}</option>
          {available.map((module) => (
            <option key={module.key} value={module.key}>
              {module.name}
            </option>
          ))}
        </SelectField>
      )}
    </fieldset>
  );
}
