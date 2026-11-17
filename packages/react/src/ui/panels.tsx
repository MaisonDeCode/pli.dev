import { useEffect, useMemo, useRef, useState } from "react";
import {
  documentStats,
  findAll,
  matchSelection,
  plainText,
  replaceMatches,
  type Doc,
  type DocumentSession,
  type Match,
} from "@pli.dev/docs";
import { domPointFromPoint } from "../dom";
import { Icons } from "./icons";
import { keepFocus } from "./primitives";

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}
const registry = (): HighlightRegistry | null =>
  typeof CSS !== "undefined" && "highlights" in CSS ? ((CSS as unknown as { highlights: HighlightRegistry }).highlights) : null;

function rangeFor(root: HTMLElement, match: Match): Range | null {
  const from = domPointFromPoint(root, { block: match.block, offset: match.from });
  const to = domPointFromPoint(root, { block: match.block, offset: match.to });
  if (!from || !to) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

export interface FindPanelProps {
  session: DocumentSession;
  /** The editable element, for highlighting matches. */
  getRoot: () => HTMLElement | null;
  /** Changes when the page layout does, so highlights are redrawn. */
  layoutKey: unknown;
  initialQuery?: string;
  showReplace?: boolean;
  onClose: () => void;
}

/** Find and replace for the document body, with the matches highlighted in the page. */
export function FindPanel({ session, getRoot, layoutKey, initialQuery = "", showReplace: initialReplace = false, onClose }: FindPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(initialReplace);
  const [current, setCurrent] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const doc = session.state;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const matches = useMemo(() => findAll(doc, query, { matchCase, wholeWord }), [doc, query, matchCase, wholeWord]);
  const index = matches.length === 0 ? -1 : Math.min(current, matches.length - 1);

  // Draw the highlights with the CSS Custom Highlight API, which doesn't touch the editor's DOM.
  useEffect(() => {
    const highlights = registry();
    const root = getRoot();
    if (!highlights || !root) return;
    const ranges = matches.map((m) => rangeFor(root, m));
    const all = ranges.filter((r, i): r is Range => !!r && i !== index);
    const HighlightCtor = (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
    highlights.set("pli-find", new HighlightCtor(...all));
    const active = ranges[index];
    if (active) highlights.set("pli-find-current", new HighlightCtor(active));
    else highlights.delete("pli-find-current");
    return () => {
      highlights.delete("pli-find");
      highlights.delete("pli-find-current");
    };
  }, [matches, index, getRoot, layoutKey]);

  const go = (target: number) => {
    if (matches.length === 0) return;
    const next = (target + matches.length) % matches.length;
    setCurrent(next);
    const match = matches[next]!;
    session.select(matchSelection(match));
    const root = getRoot();
    const range = root && rangeFor(root, match);
    range?.startContainer.parentElement?.scrollIntoView({ block: "center" });
  };

  const replaceCurrent = () => {
    const match = matches[index];
    if (!match) return;
    session.select(matchSelection(match));
    session.exec(replaceMatches([match], replacement));
    // The next match slides into the same slot.
    setCurrent(index);
  };

  const replaceAll = () => {
    if (matches.length === 0) return;
    session.select(matchSelection(matches[0]!));
    session.exec(replaceMatches(matches, replacement));
  };

  return (
    <div className="pli-find" role="search" aria-label="Find and replace">
      <div className="pli-find-row">
        <input
          ref={input}
          className="pli-find-input"
          type="text"
          value={query}
          placeholder="Find"
          aria-label="Find"
          onChange={(e) => { setQuery(e.target.value); setCurrent(0); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? index - 1 : index + 1); }
            if (e.key === "Escape") onClose();
          }}
        />
        <span className="pli-find-count" aria-live="polite">
          {query ? (matches.length ? `${index + 1} of ${matches.length}` : "No results") : ""}
        </span>
        <button type="button" className="pli-tool" aria-label="Previous match" onMouseDown={keepFocus} onClick={() => go(index - 1)} disabled={matches.length === 0}>{Icons.up}</button>
        <button type="button" className="pli-tool" aria-label="Next match" onMouseDown={keepFocus} onClick={() => go(index + 1)} disabled={matches.length === 0}>{Icons.down}</button>
        <button type="button" className="pli-tool" aria-label="Close find" onClick={onClose}>{Icons.close}</button>
      </div>
      {replaceOpen && (
        <div className="pli-find-row">
          <input
            className="pli-find-input"
            type="text"
            value={replacement}
            placeholder="Replace with"
            aria-label="Replace with"
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
          />
          <button type="button" className="pli-button" onClick={replaceCurrent} disabled={matches.length === 0}>Replace</button>
          <button type="button" className="pli-button" onClick={replaceAll} disabled={matches.length === 0}>Replace all</button>
        </div>
      )}
      <div className="pli-find-options">
        <label><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
        <label><input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole word</label>
        {!replaceOpen && <button type="button" className="pli-link-button" onClick={() => setReplaceOpen(true)}>Replace…</button>}
      </div>
    </div>
  );
}

export interface OutlineEntry {
  id: string;
  level: number;
  text: string;
}

export function outlineOf(doc: Doc): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const block of doc.blocks) {
    if (block.type === "title") entries.push({ id: block.id, level: 0, text: plainText(block.runs) || "Untitled" });
    else if (block.type === "heading") entries.push({ id: block.id, level: block.level, text: plainText(block.runs) || "Untitled" });
  }
  return entries;
}

/** The document's headings, as a list that jumps to each one. */
export function OutlinePanel({ entries, onNavigate, onClose }: { entries: OutlineEntry[]; onNavigate: (id: string) => void; onClose: () => void }) {
  return (
    <nav className="pli-outline" aria-label="Document outline">
      <div className="pli-outline-head">
        <strong>Outline</strong>
        <button type="button" className="pli-tool" aria-label="Close outline" onClick={onClose}>{Icons.close}</button>
      </div>
      {entries.length === 0 ? (
        <p className="pli-outline-empty">Headings you add will appear here.</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id} style={{ paddingLeft: `${Math.max(0, entry.level - 1) * 0.9}rem` }}>
              <button type="button" onClick={() => onNavigate(entry.id)} className={entry.level === 0 ? "pli-outline-title" : undefined}>
                {entry.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

export interface StatusBarProps {
  doc: Doc;
  /** The page the selection is on, and the page count, when paginated. */
  page?: { current: number; total: number } | null;
  zoom: number;
  onZoom: (zoom: number) => void;
  view: "pages" | "continuous";
  onView: (view: "pages" | "continuous") => void;
  /** Leave out the layout switch and zoom, because the toolbar has them. */
  hideLayout?: boolean;
}

export const ZOOMS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2];

export function StatusBar({ doc, page, zoom, onZoom, view, onView, hideLayout }: StatusBarProps) {
  const stats = useMemo(() => documentStats(doc), [doc]);
  const step = (direction: 1 | -1) => {
    const next = direction > 0 ? ZOOMS.find((z) => z > zoom + 0.001) : [...ZOOMS].reverse().find((z) => z < zoom - 0.001);
    if (next) onZoom(next);
  };
  return (
    <div className="pli-status" role="status">
      <span className="pli-status-page">
        {page ? (
          <>
            <span className="pli-status-long">{`Page ${page.current} of ${page.total}`}</span>
            <span className="pli-status-short" aria-hidden="true">{`${page.current} / ${page.total}`}</span>
          </>
        ) : (
          "Continuous"
        )}
      </span>
      <span className="pli-status-words">{stats.words.toLocaleString()} {stats.words === 1 ? "word" : "words"}</span>
      <span className="pli-spacer-flex" />
      {!hideLayout && (
        <>
        <div className="pli-segmented" role="group" aria-label="Layout">
          <button type="button" aria-pressed={view === "pages"} onClick={() => onView("pages")}>Pages</button>
          <button type="button" aria-pressed={view === "continuous"} onClick={() => onView("continuous")}>Pageless</button>
        </div>
        <button type="button" className="pli-tool" aria-label="Zoom out" onClick={() => step(-1)}>{Icons.minus}</button>
        <select aria-label="Zoom" value={ZOOMS.includes(zoom) ? zoom : "custom"} onChange={(e) => onZoom(Number(e.target.value))}>
          {!ZOOMS.includes(zoom) && <option value="custom">{Math.round(zoom * 100)}%</option>}
          {ZOOMS.map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
        </select>
        <button type="button" className="pli-tool" aria-label="Zoom in" onClick={() => step(1)}>{Icons.plus}</button>
        </>
      )}
    </div>
  );
}
