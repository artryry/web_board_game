import type { ComponentProps } from "react";

import { buttonClasses, type ButtonVariant } from "./buttonStyles";
import { Spinner } from "./Spinner";

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  /** Shows a spinner and blocks clicks while an action runs. */
  busy?: boolean;
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
      className={buttonClasses(variant, className)}
      {...props}
    >
      {busy && <Spinner size="sm" />}
      {children}
    </button>
  );
}
