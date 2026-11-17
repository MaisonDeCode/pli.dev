import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CollabRoom, Users, memoryHub, type DocAnchor } from "@pli.dev/docs";
import { PliDocument, useDocumentSession } from "@pli.dev/react";
import { liveFonts } from "./fonts";
import { Player } from "./player";
import { DocsChrome } from "./docs/chrome";
import { MAYA, createPeople } from "./docs/people";
import { blankDoc, createScript } from "./docs/script";
import type { LiveBodyProps } from "./types";

/** A US Letter page is 816 CSS pixels wide; the comments panel is 19rem (304px) wide. */
const PAGE_PX = 816;
const PANEL_PX = 304;

/** The zoom at which a page and the comments panel fit side by side in a box this wide. */
function fitZoom(width: number): number {
  const w = width > 0 ? width : 1000;
  return Math.max(0.55, Math.min(1, (w - PANEL_PX - 36) / PAGE_PX));
}

/**
 * The live Pli.Documents editor of the landing page: the real `PliDocument`, with a compact chrome (the toolbar, no menu
 * bar, ruler or status bar), driven through its session by the script in ./docs/script.ts. See ./player.ts for how steps
 * are played and rebuilt, and ./docs/script.ts for what each step contains.
 */
export default function DocsLive({ step, steps, interactive, reducedMotion, onReady }: LiveBodyProps) {
  const [people] = useState(createPeople);
  const session = useDocumentSession(blankDoc, { comments: { users: people.users } });
  // The teammate is a second member of the same room, over an in-memory pipe: no network.
  const [rooms] = useState(() => {
    const hub = memoryHub();
    return {
      me: new CollabRoom<DocAnchor>({ room: "pli-live-docs", transport: hub.transport(), users: people.users }),
      teammate: new CollabRoom<DocAnchor>({ room: "pli-live-docs", transport: hub.transport(), users: new Users(MAYA) }),
    };
  });

  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  useLayoutEffect(() => setZoom(fitZoom(box.current?.clientWidth ?? 0)), []);

  const player = useRef<Player | null>(null);
  const chromeRef = useRef<DocsChrome | null>(null);
  const ready = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Keeps the caret in view while text is typed: the canvas scrolls, never the page.
  const reveal = (toTop = false) => {
    const root = box.current;
    const canvas = root?.querySelector<HTMLElement>(".pli-canvas");
    if (!root || !canvas) return;
    if (toTop) {
      canvas.scrollTop = 0;
      return;
    }
    const focus = session.selection?.focus.block;
    const block = focus ? root.querySelector<HTMLElement>(`[data-block-id="${focus}"]`) : null;
    if (!block) return;
    const c = canvas.getBoundingClientRect();
    const b = block.getBoundingClientRect();
    if (b.height === 0 && b.top === 0) return; // nothing is laid out (a test)
    const margin = 64;
    if (b.bottom > c.bottom - margin) canvas.scrollTop += b.bottom - (c.bottom - margin);
    else if (b.top < c.top + margin) canvas.scrollTop -= c.top + margin - b.top;
  };

  useEffect(() => {
    if (zoom === null) return;
    const chrome = new DocsChrome(() => box.current, rooms.teammate);
    const script = createScript(session, people, chrome);
    const p = new Player({
      segments: script,
      reset: () => {
        chrome.comments(false);
        chrome.teammate(null);
        session.reset(blankDoc());
        // The new document's comments are read in; the script's comment is made after that.
        return session.comments!.ready;
      },
      afterAction: () => reveal(),
      settled: (at) => {
        reveal(at === 0);
        if (ready.current) return;
        void chrome.idle().then(() =>
          chrome.afterPaint(() => {
            if (ready.current) return;
            ready.current = true;
            onReadyRef.current();
          }),
        );
      },
    });
    chromeRef.current = chrome;
    player.current = p;
    return () => {
      p.dispose();
      chrome.dispose();
      player.current = null;
      chromeRef.current = null;
    };
    // `reveal` only reads refs and the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, people, rooms, zoom]);

  // Which step to show: played when it is the next one, rebuilt in any other case. Once the visitor takes over, hands off.
  const handedOver = useRef(false);
  useEffect(() => {
    const p = player.current;
    if (!p || zoom === null) return;
    if (interactive) {
      if (!handedOver.current) {
        handedOver.current = true;
        p.stop();
        chromeRef.current?.cancel();
        // What was typed for the show is not the visitor's to undo.
        if (session.canUndo) session.reset(session.state);
      }
      return;
    }
    if (handedOver.current) {
      handedOver.current = false;
      // Back to the tour: the document is rebuilt for the step (the visitor's edits are gone).
    }
    p.goTo(Math.min(step, steps - 1, 2), !reducedMotion);
  }, [step, steps, interactive, reducedMotion, zoom, session]);

  return (
    <div ref={box} style={{ height: "100%", width: "100%", position: "relative", overflow: "hidden" }}>
      {zoom !== null && (
        <PliDocument
          session={session}
          room={rooms.me}
          fonts={liveFonts()}
          defaultZoom={zoom}
          menu={false}
          ruler={false}
          statusBar={false}
          aria-label="Product launch one-pager"
        />
      )}
    </div>
  );
}
