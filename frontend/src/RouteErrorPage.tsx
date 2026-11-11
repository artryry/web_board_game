import { Button } from "@/ui/Button";

/**
 * Shown instead of a page that threw while rendering. The error is already logged (the router's
 * onError); the router's own screen would show the stack trace, in production too.
 */
export function RouteErrorPage() {
  return (
    <section role="alert" aria-labelledby="route-error-title" className="py-16 text-center">
      <h1 id="route-error-title" className="text-2xl font-semibold">
        Something went wrong
      </h1>
      <p className="mt-2 text-text-muted">This page hit an error. Reloading usually helps.</p>
      <Button
        className="mt-6"
        onClick={() => {
          window.location.reload();
        }}
      >
        Reload the page
      </Button>
    </section>
  );
}
