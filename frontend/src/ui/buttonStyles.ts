// Shared by Button and ButtonLink, so a link that acts as a button looks like one.

export type ButtonVariant = "primary" | "secondary" | "danger";

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary: "bg-accent text-bg hover:brightness-110",
  secondary: "border border-border-strong bg-surface-raised text-text hover:bg-surface",
  danger: "bg-danger text-bg hover:brightness-110",
};

export function buttonClasses(variant: ButtonVariant, className = ""): string {
  return `inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`;
}
