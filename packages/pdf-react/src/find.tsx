import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Page } from "@pli.dev/pdf";
import { keepFocus } from "@pli.dev/react";
import type { PageSources } from "./engine";
import { MOD } from "./shortcuts";
import { searchDocument, type SearchHit } from "./search";
import { PdfIcons as I } from "./icons";
import { ReplaceRow, type ReplaceState } from "./replace";

export interface FindState {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  hits: SearchHit[];
  /** Position of the current match in `hits`, or -1. */
  current: number;
  /** The search is still going through pages. */
  searching: boolean;
  setQuery(query: string): void;
  setMatchCase(on: boolean): void;
  setWholeWord(on: boolean): void;
  next(): void;
  prev(): void;
}

/**
 * Search of the whole document as the person types. Pages are searched one after another without freezing the page, a
 * new query (or a change of pages) cancels the search in progress, and the first match is shown as soon as it is found.
 */
export function useFind(pages: PageSources, list: readonly Page[], active: boolean, onReveal: (hit: SearchHit) => void, initial = ""): FindState {
  const [query, setQueryState] = useState(initial);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [current, setCurrent] = useState(-1);
  const [searching, setSearching] = useState(false);
  const latest = useRef({ list, onReveal, current, hits });
  latest.current = { list, onReveal, current, hits };
  const listKey = useMemo(() => list.map((p) => pages.key(p)).join("|"), [list, pages]);
  // Show the first match of a new search as soon as it turns up.
  const wantFirst = useRef(true);

  useEffect(() => {
    if (!active || !query.trim()) {
      setHits([]);
      setCurrent(-1);
      setSearching(false);
      return;
    }
    const ctl = new AbortController();
    const found: SearchHit[] = [];
    let flushed = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      if (ctl.signal.aborted || flushed === found.length) return;
      flushed = found.length;
      setHits(found.slice());
      const at = latest.current.current;
      if (at < 0) {
        setCurrent(0);
        if (wantFirst.current) {
          wantFirst.current = false;
          latest.current.onReveal(found[0]!);
        }
      } else setCurrent(Math.min(at, found.length - 1));
    };
    setSearching(true);
    setHits([]);
    searchDocument({
      query,
      matchCase,
      wholeWord,
      count: latest.current.list.length,
      runs: (i) => pages.text(latest.current.list[i]!),
      signal: ctl.signal,
      onPage: (_i, h) => {
        if (!h.length) return;
        found.push(...h);
        if (found.length === h.length) flush();
        else timer ??= setTimeout(flush, 60);
      },
    }).then(() => {
      if (ctl.signal.aborted) return;
      if (timer) clearTimeout(timer);
      flush();
      if (found.length === 0) setCurrent(-1);
      setSearching(false);
    });
    return () => {
      ctl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [active, query, matchCase, wholeWord, pages, listKey]);

  const setQuery = useCallback((q: string) => {
    wantFirst.current = true;
    setCurrent(-1);
    setQueryState(q);
  }, []);
  const step = useCallback((dir: 1 | -1) => {
    const { hits: all, current: at, onReveal: reveal } = latest.current;
    if (!all.length) return;
    const to = (Math.max(0, at) + (at < 0 ? 0 : dir) + all.length) % all.length;
    setCurrent(to);
    reveal(all[to]!);
  }, []);

  return {
    query,
    matchCase,
    wholeWord,
    hits,
    current,
    searching,
    setQuery,
    setMatchCase: (on) => {
      wantFirst.current = true;
      setCurrent(-1);
      setMatchCase(on);
    },
    setWholeWord: (on) => {
      wantFirst.current = true;
      setCurrent(-1);
      setWholeWord(on);
    },
    next: useCallback(() => step(1), [step]),
    prev: useCallback(() => step(-1), [step]),
  };
}

/** "3 of 17", "No results", or "Searching…". */
export function findStatus(f: Pick<FindState, "query" | "hits" | "current" | "searching">): string {
  if (!f.query.trim()) return "";
  if (f.hits.length === 0) return f.searching ? "Searching…" : "No results";
  return `${Math.max(0, f.current) + 1} of ${f.hits.length}${f.searching ? "+" : ""}`;
}

export interface FindBarProps {
  find: FindState;
  onClose: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** More buttons in the bar, before Close (the annotation tools add "Redact all matches"). */
  actions?: ReactNode;
  /** Find and replace: the state of the replace row (see `useReplace`). Without it there is no replace. */
  replace?: ReplaceState;
}

/** The find bar: a box, the count, previous and next, and the two options. */
export function FindBar({ find, onClose, inputRef, actions, replace }: FindBarProps) {
  const status = findStatus(find);
  return (
    <div className="pli-pdf-find" role="search" aria-label="Find in document" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}>
      <input
        ref={inputRef}
        className="pli-pdf-find-input"
        type="search"
        aria-label="Find"
        placeholder="Find in document"
        value={find.query}
        autoFocus
        onChange={(e) => find.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.shiftKey ? find.prev() : find.next();
          }
        }}
      />
      <span className="pli-pdf-find-count" role="status" aria-live="polite">
        {status}
      </span>
      <button type="button" className="pli-tool" aria-label="Previous match" title="Previous match (Shift+Enter)" onMouseDown={keepFocus} onClick={find.prev} disabled={!find.hits.length}>
        {I.up}
      </button>
      <button type="button" className="pli-tool" aria-label="Next match" title="Next match (Enter)" onMouseDown={keepFocus} onClick={find.next} disabled={!find.hits.length}>
        {I.down}
      </button>
      <button type="button" className="pli-tool pli-pdf-find-toggle" aria-label="Match case" title="Match case" aria-pressed={find.matchCase} onClick={() => find.setMatchCase(!find.matchCase)}>
        Aa
      </button>
      <button type="button" className="pli-tool pli-pdf-find-toggle" aria-label="Whole words" title="Whole words" aria-pressed={find.wholeWord} onClick={() => find.setWholeWord(!find.wholeWord)}>
        <u>ab</u>
      </button>
      {replace && (
        <button type="button" className="pli-tool pli-pdf-find-toggle" aria-label="Show replace" title={`Find and replace (${MOD}H)`} aria-pressed={replace.open} onMouseDown={keepFocus} onClick={() => replace.setOpen(!replace.open)}>
          {I.findReplace}
        </button>
      )}
      {actions}
      <button type="button" className="pli-tool" aria-label="Close find" title="Close (Esc)" onMouseDown={keepFocus} onClick={onClose}>
        {I.close}
      </button>
      {replace?.open && <ReplaceRow find={find} replace={replace} />}
    </div>
  );
}
