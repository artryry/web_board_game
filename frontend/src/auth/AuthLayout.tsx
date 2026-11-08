import type { ReactNode } from "react";

interface AuthLayoutProps {
  title: string;
  children: ReactNode;
  /** The link to the other auth page. */
  footer: ReactNode;
}

/** The centred panel that the login and register pages share. */
export function AuthLayout({ title, children, footer }: AuthLayoutProps) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-lg">
        <p className="text-center text-sm font-semibold tracking-widest text-accent uppercase">
          Card Table
        </p>
        <h1 className="mt-1 mb-6 text-center text-2xl font-semibold">{title}</h1>
        {children}
        <p className="mt-6 text-center text-sm text-text-muted">{footer}</p>
      </div>
    </main>
  );
}
