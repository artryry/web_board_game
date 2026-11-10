import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { cardCountQuery, UNGROUPED } from "@/api/hooks/useCards";
import type { CardGroup } from "@/api/hooks/useCardGroups";
import { Button } from "@/ui/Button";

import { DeleteGroupDialog } from "./DeleteGroupDialog";
import { GroupNameDialog, type GroupNameTarget } from "./GroupNameDialog";
import { librarySearch } from "./libraryParams";

interface CardGroupPanelProps {
  groups: readonly CardGroup[];
  /** The open view: a group id, `ungrouped`, or undefined for all cards. */
  active: string | undefined;
  onGroupDeleted: (group: CardGroup) => void;
}

/** The library's folders: all cards, the ungrouped ones, and each group with its count. */
export function CardGroupPanel({ groups, active, onGroupDeleted }: CardGroupPanelProps) {
  const [searchParams] = useSearchParams();
  const allCount = useQuery(cardCountQuery("all"));
  const ungroupedCount = useQuery(cardCountQuery("ungrouped"));
  const [naming, setNaming] = useState<GroupNameTarget | null>(null);
  const [deleting, setDeleting] = useState<CardGroup | null>(null);
  const linkTo = (group: string | null) => ({ search: librarySearch(searchParams, { group }) });

  return (
    <nav aria-labelledby="card-groups-title" className="flex flex-col gap-3">
      <h2 id="card-groups-title" className="text-sm font-medium text-text-muted">
        Groups
      </h2>
      <ul className="flex flex-col gap-1">
        <GroupLink
          to={linkTo(null)}
          label="All cards"
          count={allCount.data}
          current={active === undefined}
        />
        <GroupLink
          to={linkTo(UNGROUPED)}
          label="Ungrouped"
          count={ungroupedCount.data}
          current={active === UNGROUPED}
        />
        {groups.map((group) => (
          <GroupLink
            key={group.id}
            to={linkTo(group.id)}
            label={group.name}
            count={group.card_count}
            current={active === group.id}
            actions={
              <>
                <IconButton
                  label={`Rename ${group.name}`}
                  onClick={() => {
                    setNaming({ mode: "rename", group });
                  }}
                >
                  <Pencil aria-hidden="true" className="size-4" />
                </IconButton>
                <IconButton
                  label={`Delete ${group.name}`}
                  onClick={() => {
                    setDeleting(group);
                  }}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </IconButton>
              </>
            }
          />
        ))}
      </ul>
      <Button
        variant="secondary"
        onClick={() => {
          setNaming({ mode: "create" });
        }}
      >
        <Plus aria-hidden="true" className="size-4" />
        New group
      </Button>

      <GroupNameDialog
        target={naming}
        onClose={() => {
          setNaming(null);
        }}
      />
      <DeleteGroupDialog
        group={deleting}
        onClose={() => {
          setDeleting(null);
        }}
        onDeleted={onGroupDeleted}
      />
    </nav>
  );
}

interface GroupLinkProps {
  to: { search: string };
  label: string;
  count: number | undefined;
  current: boolean;
  actions?: ReactNode;
}

function GroupLink({ to, label, count, current, actions }: GroupLinkProps) {
  return (
    <li className="flex items-center gap-1">
      <Link
        to={to}
        aria-current={current ? "page" : undefined}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 ${current ? "bg-surface-raised font-medium text-text" : "text-text-muted hover:text-text"}`}
      >
        <span className="truncate">{label}</span>{" "}
        {count !== undefined && (
          <span className="ml-auto text-sm text-text-muted">
            {count} <span className="sr-only">{count === 1 ? "card" : "cards"}</span>
          </span>
        )}
      </Link>
      {actions}
    </li>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="rounded-md p-1.5 text-text-muted hover:bg-surface-raised hover:text-text"
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}
