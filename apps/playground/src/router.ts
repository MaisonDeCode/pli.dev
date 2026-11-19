import { useEffect, useState } from "react";

/** The screens the playground can show. The landing page is the one without an id. */
export type DemoId = "basics" | "collaboration" | "sheets" | "decks" | "pdf" | "embed" | "generate" | "builder";

const IDS: readonly DemoId[] = ["basics", "collaboration", "sheets", "decks", "pdf", "embed", "generate", "builder"];

/** The hash that opens a screen (`#/basics`), or the landing page for `null`. */
export function routePath(demo: DemoId | null): string {
  return demo ? `#/${demo}` : "";
}

/**
 * Which screen an address points at. Screens live in the hash so the playground works from any static host, and
 * so a link into one keeps the query (`?room=…`, `?readonly`) its screen reads. Links from before there was a
 * landing page (`?mode=collab`, a bare `?readonly`) still open the screen they meant.
 */
export function resolveRoute(loc: { search: string; hash: string }): DemoId | null {
  const fromHash = loc.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  const known = IDS.find((id) => id === fromHash);
  if (known) return known;
  const query = new URLSearchParams(loc.search);
  if (query.get("mode") === "collab") return "collaboration";
  if (query.get("mode") === "basics" || query.has("readonly")) return "basics";
  return null;
}

/** The current screen, kept in step with the address and the browser's back button. */
export function useRoute(): DemoId | null {
  const [route, setRoute] = useState(() => resolveRoute(location));
  useEffect(() => {
    const update = () => setRoute(resolveRoute(location));
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return route;
}

/** Opens a screen. Leaving one for the landing page also drops the query that belonged to it. */
export function openDemo(demo: DemoId | null): void {
  const url = new URL(location.href);
  if (demo === null) url.search = "";
  else url.searchParams.delete("mode");
  url.hash = routePath(demo);
  // pushState doesn't reload when the query changes, and doesn't announce itself, so say so.
  history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
