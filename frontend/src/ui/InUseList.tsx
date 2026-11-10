import { Link } from "react-router";

interface InUseListProps {
  /** What the items are, for example "Cards". */
  label: string;
  items: readonly { id: string; name: string }[];
  /** Where each item can be fixed. Items without a page show as names. */
  linkTo?: (id: string) => string;
}

/** The items that block a delete or a change, as a server's 409 lists them. */
export function InUseList({ label, items, linkTo }: InUseListProps) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2 text-text">
      <p className="font-medium">{label}</p>
      <ul className="list-inside list-disc">
        {items.map((item) => (
          <li key={item.id}>
            {linkTo === undefined ? (
              item.name
            ) : (
              <Link to={linkTo(item.id)} className="text-accent hover:underline">
                {item.name}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
