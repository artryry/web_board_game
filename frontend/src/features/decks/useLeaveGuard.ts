import { useEffect, useRef } from "react";
import { useBlocker } from "react-router";

/**
 * Asks before the user leaves a page with unsaved changes: in-app navigation is held by the
 * router's blocker (the page shows `LeaveGuardDialog`), and closing or reloading the tab gets the
 * browser's own prompt. `allowLeave` lets a navigation the page starts itself (after a save or a
 * delete) go through, even before the page has re-rendered as clean.
 */
export function useLeaveGuard(dirty: boolean) {
  const allowed = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowed.current && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty]);

  return {
    blocker,
    allowLeave: () => {
      allowed.current = true;
    },
  };
}
