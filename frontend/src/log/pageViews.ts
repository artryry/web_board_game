import type { DataRouter, RouterState } from "react-router";

import { log } from "./logger";

/** The route a location matched, like /cards/:id: no ids, so views of one page look alike. */
export function routePattern(matches: RouterState["matches"]): string {
  let pattern = "";
  for (const { route } of matches) {
    if (route.path === undefined) continue;
    pattern = route.path.startsWith("/")
      ? route.path
      : `${pattern.replace(/\/$/, "")}/${route.path}`;
  }
  return pattern === "" ? "/" : pattern;
}

/** Logs `nav.page_viewed` for the first page and every navigation, for the breadcrumbs. */
export function logPageViews(router: DataRouter): () => void {
  let lastKey: string | null = null;
  const report = (state: RouterState) => {
    if (state.navigation.state !== "idle" || state.location.key === lastKey) return;
    lastKey = state.location.key;
    log.debug("nav.page_viewed", { route: routePattern(state.matches) });
  };
  report(router.state);
  return router.subscribe(report);
}
