/** How React islands follow the page's scroll story (see scripts/motion.ts for who publishes it). */
import { useEffect, useState } from "react";
import type { StoryState } from "../scripts/motion";

export type { StoryState };

/** The latest state of a story, or undefined before the page's script has published one. Updates on every change. */
export function useStory(id: string | undefined): StoryState | undefined {
  const [state, setState] = useState<StoryState | undefined>(undefined);
  useEffect(() => {
    if (!id) return;
    setState(window.__pliStory?.[id]);
    const on = (e: Event) => {
      const detail = (e as CustomEvent<StoryState>).detail;
      if (detail.id === id) setState(detail);
    };
    window.addEventListener("pli:story", on);
    return () => window.removeEventListener("pli:story", on);
  }, [id]);
  return state;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** True on screens wide enough, and connections willing, to run a live editor. Phones and data-saver users get the poster. */
export function useCanRunEditor(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 900px)");
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const update = () => setCan(m.matches && !conn?.saveData);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  return can;
}
