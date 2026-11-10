import { useController, useFormContext, useFormState } from "react-hook-form";

import { SchemaForm } from "@/catalog/SchemaForm";
import { defaultParams } from "@/catalog/schemaFields";
import { findModule, type SpellSpec } from "@/catalog/useCatalog";
import { SelectField } from "@/ui/SelectField";

import type { CardFormValues } from "./cardValues";

/** A spell's one effect: a required choice, set up with its `SchemaForm`. */
export function SpellEffectField({ spells }: { spells: readonly SpellSpec[] }) {
  const { control } = useFormContext<CardFormValues>();
  // Destructured: the hooks lint reads `field.ref` as a React ref and every other `field.*` with it.
  const {
    field: { ref, name, value, onChange, onBlur },
  } = useController({
    control,
    name: "abilities",
    rules: { validate: (abilities) => abilities.length === 1 || "Choose an effect." },
  });
  const { errors } = useFormState({ control, name: "abilities" });
  // Once a creature's ability list has been shown, the form treats `abilities` as a field array
  // and files this error under `root`.
  const error = errors.abilities?.message ?? errors.abilities?.root?.message;
  const effect = value[0];
  const spec = effect === undefined ? undefined : findModule(spells, effect.key);

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Effect"
        ref={ref}
        name={name}
        value={effect?.key ?? ""}
        error={error}
        onBlur={onBlur}
        onChange={(event) => {
          const next = findModule(spells, event.target.value);
          // A new effect starts from its own defaults.
          onChange(
            next === undefined
              ? []
              : [{ key: next.key, params: defaultParams(next.params_schema) }],
          );
        }}
      >
        <option value="">Choose an effect</option>
        {spells.map((spell) => (
          <option key={spell.key} value={spell.key}>
            {spell.name}
          </option>
        ))}
      </SelectField>
      {spec !== undefined && (
        <>
          <p className="text-sm text-text-muted">{spec.description}</p>
          <SchemaForm key={spec.key} schema={spec.params_schema} name="abilities.0.params" />
        </>
      )}
    </div>
  );
}
