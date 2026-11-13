import { Link, NavLink, Outlet } from "react-router";

import { useAuth, useCurrentUser } from "@/auth/useAuth";
import { Button } from "@/ui/Button";

// Later milestones add their pages here; the nav lists only pages that exist. Only the dashboard
// matches its path exactly, so a card's editor still marks Cards as the current section.
const NAV_ITEMS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/cards", label: "Cards", end: false },
  { to: "/decks", label: "Decks", end: false },
  { to: "/rules", label: "Rules", end: false },
  { to: "/origins", label: "Origins", end: false },
];

export function AppShell() {
  const user = useCurrentUser();
  const { logout } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="text-lg font-semibold text-accent">
            Card Table
          </Link>
          <nav aria-label="Main">
            <ul className="flex gap-4">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      isActive ? "font-medium text-text" : "text-text-muted hover:text-text"
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-text-muted">
              Logged in as <span className="font-medium text-text">{user.username}</span>
            </span>
            <Button variant="secondary" onClick={logout}>
              Log out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
