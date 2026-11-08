interface SpinnerProps {
  /** Announced to screen readers. Without it the spinner is decorative. */
  label?: string;
  size?: "sm" | "md" | "lg";
}

const SIZES = { sm: "size-4 border-2", md: "size-6 border-2", lg: "size-10 border-4" };

export function Spinner({ label, size = "md" }: SpinnerProps) {
  const circle = (
    <span
      aria-hidden="true"
      className={`inline-block rounded-full border-current border-t-transparent motion-safe:animate-spin ${SIZES[size]}`}
    />
  );
  if (label === undefined) return circle;
  return (
    <span role="status" className="inline-flex items-center">
      {circle}
      <span className="sr-only">{label}</span>
    </span>
  );
}
