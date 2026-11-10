import type { CardFilters } from "@/api/hooks/useCards";
import type { Origin } from "@/api/hooks/useOrigins";
import { SelectField } from "@/ui/SelectField";

import type { LibraryParam } from "./libraryParams";
import { OriginOptions } from "./OriginOptions";

interface LibraryFiltersProps {
  origins: readonly Origin[];
  filters: CardFilters;
  onChange: (param: LibraryParam, value: string | null) => void;
}

/** The library's origin and kind filters. Their values live in the URL. */
export function LibraryFilters({ origins, filters, onChange }: LibraryFiltersProps) {
  return (
    <div className="flex flex-wrap gap-4">
      <SelectField
        label="Origin"
        value={filters.originId ?? ""}
        onChange={(event) => {
          onChange("origin", event.target.value);
        }}
      >
        <option value="">All origins</option>
        <OriginOptions origins={origins} />
      </SelectField>
      <SelectField
        label="Kind"
        value={filters.kind ?? ""}
        onChange={(event) => {
          onChange("kind", event.target.value);
        }}
      >
        <option value="">All kinds</option>
        <option value="creature">Creatures</option>
        <option value="spell">Spells</option>
      </SelectField>
    </div>
  );
}
