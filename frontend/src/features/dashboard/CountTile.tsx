import type { UseQueryResult } from "@tanstack/react-query";

import { Spinner } from "@/ui/Spinner";

interface CountTileProps {
  label: string;
  count: UseQueryResult<number>;
}

/** One number on the dashboard. Renders a `<div>` of a `<dl>`. */
export function CountTile({ label, count }: CountTileProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="mt-2 text-3xl font-semibold">
        <CountValue label={label} count={count} />
      </dd>
    </div>
  );
}

function CountValue({ label, count }: CountTileProps) {
  if (count.isPending) return <Spinner label={`Loading ${label.toLowerCase()}`} />;
  if (count.isError) return <span className="text-base text-danger">Couldn't load</span>;
  return count.data;
}
