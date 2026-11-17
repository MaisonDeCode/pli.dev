import { useEffect, useMemo, useState } from "react";
import { keepFocus } from "@pli.dev/react";
import { replaceRange, type DeckSession, type FindHit, type Paragraph } from "@pli.dev/decks";
import { DeckIcons as I } from "./icons";
import { useDeckRevision } from "./hooks";
import type { TextHighlight } from "./SlideView";

/** Replaces one match (text in a shape or cell, or in the notes), keeping the marks of the text it replaces. */
export function replaceHit(session: DeckSession, hit: FindHit, replacement: string): void {
  if (!hit.element) {
    const lines = session.slide(hit.slide).notes.split("\n");
    const line = lines[hit.paragraph] ?? "";
    lines[hit.paragraph] = line.slice(0, hit.offset) + replacement + line.slice(hit.offset + hit.length);
    session.setNotes(hit.slide, lines.join("\n"), { merge: false });
    return;
  }
  const range = { from: { p: hit.paragraph, o: hit.offset }, to: { p: hit.paragraph, o: hit.offset + hit.length } };
  const walk = (list: import("@pli.dev/decks").Element[]): import("@pli.dev/decks").Element | undefined => {
    for (const e of list) {
      if (e.id === hit.element) return e;
      if (e.type === "group") {
        const f = walk(e.children);
        if (f) return f;
      }
    }
    return undefined;
  };
  const el = walk(session.slide(hit.slide).elements);
  if (!el) return;
  const swap = (ps: Paragraph[]) => replaceRange(ps, range, replacement).paragraphs;
  if (el.type === "shape" && el.text) session.setText(hit.slide, el.id, swap(el.text.paragraphs));
  else if (el.type === "table" && hit.cell) session.setCellParagraphs(hit.slide, el.id, hit.cell[0], hit.cell[1], swap(el.rows[hit.cell[0]]!.cells[hit.cell[1]]!.paragraphs));
}

export interface FindBarProps {
  session: DeckSession;
  onClose: () => void;
  /** Show a match: the editor switches to its slide and selects its element. */
  onGoto: (hit: FindHit) => void;
  /** The matches to highlight on the slide shown. */
  onHighlights: (highlights: TextHighlight[]) => void;
  readOnly?: boolean;
  initialQuery?: string;
}

/** Find and replace across all slides and notes, with the matches highlighted and stepped through. */
export function FindBar({ session, onClose, onGoto, onHighlights, readOnly, initialQuery = "" }: FindBarProps) {
  const rev = useDeckRevision(session);
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [index, setIndex] = useState(0);
  const hits = useMemo(() => session.find(query, { matchCase }), [session, query, matchCase, rev]);
  const at = hits.length ? Math.min(index, hits.length - 1) : -1;

  useEffect(() => {
    onHighlights(hits.map((h, i) => ({ element: h.element ?? "", cell: h.cell, paragraph: h.paragraph, offset: h.offset, length: h.length, current: i === at, slide: h.slide }) as TextHighlight & { slide: string }));
  }, [hits, at, onHighlights]);
  useEffect(() => () => onHighlights([]), [onHighlights]);

  const step = (dir: 1 | -1) => {
    if (!hits.length) return;
    const n = (at + dir + hits.length) % hits.length;
    setIndex(n);
    onGoto(hits[n]!);
  };

  return (
    <div className="pli-deck-find-bar" role="search" aria-label="Find and replace" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}>
      <input
        className="pli-deck-find-input"
        aria-label="Find"
        placeholder="Find"
        value={query}
        autoFocus
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          }
        }}
      />
      <span className="pli-deck-find-count" role="status" aria-live="polite">{query ? (hits.length ? `${at + 1} of ${hits.length}` : "No results") : ""}</span>
      <button type="button" className="pli-tool" aria-label="Previous match" onMouseDown={keepFocus} onClick={() => step(-1)} disabled={!hits.length}>{I.up}</button>
      <button type="button" className="pli-tool" aria-label="Next match" onMouseDown={keepFocus} onClick={() => step(1)} disabled={!hits.length}>{I.down}</button>
      {!readOnly && (
        <>
          <input className="pli-deck-find-input" aria-label="Replace with" placeholder="Replace with" value={replacement} onChange={(e) => setReplacement(e.target.value)} />
          <button type="button" className="pli-button" disabled={at < 0} onClick={() => { const h = hits[at]!; replaceHit(session, h, replacement); }}>Replace</button>
          <button type="button" className="pli-button" disabled={!hits.length} onClick={() => session.replaceAll(query, replacement, { matchCase })}>Replace all</button>
        </>
      )}
      <label className="pli-checkbox-row">
        <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
        <span>Match case</span>
      </label>
      <button type="button" className="pli-tool" aria-label="Close find" onMouseDown={keepFocus} onClick={onClose}>{I.close}</button>
    </div>
  );
}
