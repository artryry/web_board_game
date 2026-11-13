import { useFormContext } from "react-hook-form";

import type { RulesFormValues } from "./rulesetValues";
import { SETTING_LABELS, type SettingPath } from "./settingFields";

export function SettingCheckbox({ path }: { path: SettingPath }) {
  const { register } = useFormContext<RulesFormValues>();
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" className="size-4 accent-accent" {...register(path)} />
      {SETTING_LABELS[path]}
    </label>
  );
}
