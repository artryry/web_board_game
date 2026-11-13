import type { ReactNode, Ref } from "react";

interface IconButtonProps {
  /** The action, such as "Delete Beasts". It is the button's name and its tooltip. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** The icon, marked `aria-hidden`. */
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/** A small button that shows only an icon, for actions on one row of a list. */
export function IconButton({ label, onClick, disabled = false, children, ref }: IconButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-1.5 text-text-muted enabled:hover:bg-surface-raised enabled:hover:text-text disabled:opacity-40"
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}
