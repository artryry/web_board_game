import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <section aria-labelledby="not-found-title" className="py-16 text-center">
      <h1 id="not-found-title" className="text-2xl font-semibold">
        Page not found
      </h1>
      <p className="mt-2 text-text-muted">There is nothing at this address.</p>
      <Link to="/" className="mt-6 inline-block text-accent hover:underline">
        Go to the dashboard
      </Link>
    </section>
  );
}
