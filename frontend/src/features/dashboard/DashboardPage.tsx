import { useLibraryCounts } from "@/api/hooks/useLibraryCounts";
import { useCurrentUser } from "@/auth/useAuth";

import { CountTile } from "./CountTile";

export function DashboardPage() {
  const user = useCurrentUser();
  const counts = useLibraryCounts();

  return (
    <section aria-labelledby="dashboard-title">
      <h1 id="dashboard-title" className="text-2xl font-semibold">
        Welcome, {user.username}
      </h1>
      <p className="mt-1 text-text-muted">Your library at a glance.</p>
      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <CountTile label="Cards" count={counts.cards} />
        <CountTile label="Card groups" count={counts.cardGroups} />
        <CountTile label="Decks" count={counts.decks} />
      </dl>
    </section>
  );
}
