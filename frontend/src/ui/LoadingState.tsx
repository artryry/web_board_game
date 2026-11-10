import { ErrorAlert } from "./ErrorAlert";
import { Spinner } from "./Spinner";

interface LoadingStateProps {
  /** The first failed load, if any. Without one, the data is still on its way. */
  error: Error | null;
}

/** What a page shows until its data is in: a spinner, or the error that stopped it. */
export function LoadingState({ error }: LoadingStateProps) {
  if (error !== null) {
    return <ErrorAlert>Couldn't load this page. {error.message}</ErrorAlert>;
  }
  return (
    <div className="flex justify-center py-16">
      <Spinner size="lg" label="Loading" />
    </div>
  );
}
