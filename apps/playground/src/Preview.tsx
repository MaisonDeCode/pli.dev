import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { userColor, type Doc, type PliUser } from "@pli.dev/docs";
import { Avatar, DocumentView } from "@pli.dev/react";
import { DeckSession } from "@pli.dev/decks";
import { SlideView } from "@pli.dev/decks-react";
import { starter } from "./basics/Basics";
import { sampleDeck } from "./decks/DecksDemo";
import { generatedSample } from "./generate/Generate";
import { TEAM } from "./collab/people";
import { labDocument } from "./collab/starter";
import type { DemoId } from "./router";

/** How wide the page is drawn before it is shrunk to fit its card. */
const PAGE_WIDTH = 816;
/** Enough of each document to fill a card; the rest would only cost time to draw. */
const BLOCKS = 12;

const PREVIEWS: Record<Exclude<DemoId, "sheets" | "decks" | "pdf">, { doc: () => Doc; people?: PliUser[] }> = {
  basics: { doc: starter },
  embed: { doc: starter },
  generate: { doc: generatedSample },
  builder: { doc: generatedSample },
  cover: { doc: generatedSample },
  collaboration: { doc: labDocument, people: TEAM },
};

/** The top of a demo's document, drawn the way the editor draws it and shrunk to fit. It can't be clicked: the card is the link. */
export function Preview({ id }: { id: DemoId }) {
  return id === "sheets" ? <SheetPreview /> : id === "decks" ? <DeckPreview /> : id === "pdf" ? <PdfPreview /> : <DocumentPreview id={id} />;
}

/** The sample deck's title slide, drawn the way the editor draws it. */
function DeckPreview() {
  const scene = useMemo(() => {
    const session = new DeckSession(sampleDeck());
    return session.scene(session.deck.slides[0]!.id);
  }, []);
  return (
    <div className="landing-preview landing-deck" aria-hidden="true">
      <SlideView scene={scene} scale={0.6} />
    </div>
  );
}

const SHEET_ROWS = [
  ["Item", "Qty", "Unit price", "Total"],
  ["Standing desk", "4", "$489.00", "$1,956.00"],
  ["Monitor", "6", "$329.99", "$1,979.94"],
  ["Ergonomic chair", "4", "$259.50", "$1,038.00"],
  ["Webcam", "6", "$79.00", "$474.00"],
  ["Headset", "8", "$119.95", "$959.60"],
  ["Whiteboard", "2", "$145.00", "$290.00"],
  ["", "", "Total", "$6,697.54"],
];

/** A few rows of the sample budget, drawn as a plain table, since the card only needs to suggest a grid. */
function SheetPreview() {
  return (
    <div className="landing-preview landing-sheet" aria-hidden="true">
      <table>
        <tbody>
          {SHEET_ROWS.map((row, r) => (
            <tr key={r} data-head={r === 0 ? "" : undefined} data-total={r === SHEET_ROWS.length - 1 ? "" : undefined}>
              {row.map((cell, c) => (
                <td key={c} data-num={c > 0 && r > 0 ? "" : undefined}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A page with a heading, a few lines, a highlight and a form field: enough to say "PDF" without loading pdf.js on the landing page. */
function PdfPreview() {
  return (
    <div className="landing-preview landing-pdf" aria-hidden="true">
      <div className="landing-pdf-page">
        <b>Pli.PDF sample</b>
        <i style={{ width: "90%" }} />
        <i data-mark="" style={{ width: "72%" }} />
        <i style={{ width: "84%" }} />
        <span>Name</span>
        <em />
      </div>
    </div>
  );
}

function DocumentPreview({ id }: { id: Exclude<DemoId, "sheets" | "decks" | "pdf"> }) {
  const [{ doc, people }] = useState(() => {
    const preview = PREVIEWS[id];
    const full = preview.doc();
    return { doc: { ...full, blocks: full.blocks.slice(0, BLOCKS) }, people: preview.people };
  });
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.35);

  useLayoutEffect(() => {
    const element = box.current!;
    const fit = () => element.clientWidth > 0 && setScale(element.clientWidth / PAGE_WIDTH);
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const watcher = new ResizeObserver(fit);
    watcher.observe(element);
    return () => watcher.disconnect();
  }, []);

  return (
    <div ref={box} className="landing-preview" aria-hidden="true">
      <div className="pli-editor landing-page" style={{ width: PAGE_WIDTH, transform: `scale(${scale})` }}>
        <DocumentView doc={doc} />
      </div>
      {people && (
        <div className="landing-people">
          {people.map((person) => (
            <Avatar key={person.id} user={{ ...person, color: userColor(person.id) }} size={22} />
          ))}
        </div>
      )}
    </div>
  );
}
