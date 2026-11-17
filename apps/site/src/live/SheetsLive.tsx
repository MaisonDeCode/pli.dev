import { useEffect, useRef, useState } from "react";
import { SheetSession } from "@pli.dev/sheets";
import { PliSheet } from "@pli.dev/sheets-react";
import { liveFonts } from "./fonts";
import { Player } from "./player";
import { blankWorkbook, createScript } from "./sheets/script";
import type { LiveBodyProps } from "./types";

/**
 * The live Pli.Sheets editor of the landing page: the real `PliSheet` (toolbar and formula bar, no menus, tabs or status bar),
 * driven through its session by the script in ./sheets/script.ts. Steps are played, or rebuilt with `session.load`, by ./player.ts.
 */
export default function SheetsLive({ step, steps, interactive, reducedMotion, onReady }: LiveBodyProps) {
  const [base] = useState(blankWorkbook);
  const [session] = useState(() => new SheetSession(base));
  const player = useRef<Player | null>(null);
  const ready = useRef(false);
  const handedOver = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let ended = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const p = new Player({
      segments: createScript(session),
      reset: () => session.load(base),
      settled: () => {
        if (ready.current || timer) return;
        // Ready once the grid has been drawn with the step's cells.
        const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
        const done = () => {
          timer = null;
          if (ended || ready.current) return;
          ready.current = true;
          onReadyRef.current();
        };
        if (raf) raf(() => raf(done));
        else timer = setTimeout(done, 32);
      },
    });
    player.current = p;
    return () => {
      ended = true;
      if (timer) clearTimeout(timer);
      p.dispose();
      player.current = null;
    };
  }, [session, base]);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    if (interactive) {
      if (!handedOver.current) {
        handedOver.current = true;
        p.stop();
        // What was filled in for the show is not the visitor's to undo.
        if (session.canUndo) session.load(session.state);
      }
      return;
    }
    handedOver.current = false;
    p.goTo(Math.min(step, steps - 1, 2), !reducedMotion);
  }, [step, steps, interactive, reducedMotion, session]);

  return (
    <div style={{ height: "100%", width: "100%", position: "relative", overflow: "hidden" }}>
      <PliSheet session={session} fonts={liveFonts()} menu={false} statusBar={false} tabs={false} />
    </div>
  );
}
