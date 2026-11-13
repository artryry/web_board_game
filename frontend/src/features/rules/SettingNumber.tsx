import { useFormContext } from "react-hook-form";

import { useFieldError } from "@/catalog/useFieldError";
import { TextField } from "@/ui/TextField";

import type { RulesFormValues } from "./rulesetValues";
import { SETTING_LABELS, type SettingPath } from "./settingFields";

/**
 * A whole-number setting. It has no bounds of its own: the server's check reports them under the
 * field ("Input should be less than or equal to 5").
 */
export function SettingNumber({ path }: { path: SettingPath }) {
  const { register } = useFormContext<RulesFormValues>();
  const error = useFieldError(path);
  return (
    <TextField
      label={SETTING_LABELS[path]}
      type="number"
      inputMode="numeric"
      step={1}
      className="w-28"
      error={error}
      {...register(path, { valueAsNumber: true })}
    />
  );
}
