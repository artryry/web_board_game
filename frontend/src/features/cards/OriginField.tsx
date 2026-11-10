import { Plus } from "lucide-react";
import { useController, useFormContext } from "react-hook-form";

import type { Origin } from "@/api/hooks/useOrigins";
import { Button } from "@/ui/Button";
import { SelectField } from "@/ui/SelectField";

import type { CardFormValues } from "./cardValues";
import { OriginOptions } from "./OriginOptions";

interface OriginFieldProps {
  origins: readonly Origin[];
  onNewOrigin: () => void;
}

/**
 * The card's origin: the templates and the user's own, plus a shortcut to make a new one. The
 * select is controlled, so an origin created in the modal is selected in the same render that
 * adds its option.
 */
export function OriginField({ origins, onNewOrigin }: OriginFieldProps) {
  const { control } = useFormContext<CardFormValues>();
  // Destructured: the hooks lint reads `field.ref` as a React ref and every other `field.*` with it.
  const {
    field: { ref, name, value, onChange, onBlur },
    fieldState,
  } = useController({ control, name: "origin_id", rules: { required: "Choose an origin." } });

  return (
    <div className="flex flex-wrap items-end gap-2">
      <SelectField
        label="Origin"
        className="min-w-48 flex-1"
        ref={ref}
        name={name}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        error={fieldState.error?.message}
      >
        <OriginOptions origins={origins} />
      </SelectField>
      <Button variant="secondary" onClick={onNewOrigin}>
        <Plus aria-hidden="true" className="size-4" />
        New origin
      </Button>
    </div>
  );
}
