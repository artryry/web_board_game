import type { ComponentProps } from "react";

import { Spinner } from "./Spinner";

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary";
  /** Shows a spinner and blocks clicks while an action runs. */
  busy?: boolean;
};

const VARIANTS = {
  primary: "bg-accent text-bg hover:brightness-110",
  secondary: "border border-border-strong bg-surface-raised text-text hover:bg-surface",
};

export function Button({
  variant = "primary",
  busy = false,
  disabled,
  type = "button",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {busy && <Spinner size="sm" />}
      {children}
    </button>
  );
}
