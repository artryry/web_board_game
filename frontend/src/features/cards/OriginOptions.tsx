import type { Origin } from "@/api/hooks/useOrigins";

/** An origin select's options: the system templates, then the user's own origins. */
export function OriginOptions({ origins }: { origins: readonly Origin[] }) {
  const templates = origins.filter((origin) => origin.is_system);
  const own = origins.filter((origin) => !origin.is_system);
  return (
    <>
      <optgroup label="Templates">
        {templates.map((origin) => (
          <option key={origin.id} value={origin.id}>
            {origin.name}
          </option>
        ))}
      </optgroup>
      {own.length > 0 && (
        <optgroup label="My origins">
          {own.map((origin) => (
            <option key={origin.id} value={origin.id}>
              {origin.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}
