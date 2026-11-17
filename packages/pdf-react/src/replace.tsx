/**
 * Find and replace. The find bar finds (in what the renderer draws); the replacing is the engine's `content.replaceAll`: a match
 * inside one piece of text of the page (a run) is written into that run as a text edit, all the matches in ONE step of undo;
 * a match that crosses two pieces of text, or sits in text that cannot be edited faithfully, is counted and left alone.
 */
import { useCallback, useRef, useState } from "react";
import { Dialog, keepFocus } from "@pli.dev/react";
import type { PdfSession, ReplaceAllResult } from "@pli.dev/pdf";
import type { FindState } from "./find";
import { PdfIcons as I } from "./icons";
import { plainMessage, type Notices } from "./store";

const plural = (n: number, one: string, many = `${one}es`) => `${n} ${n === 1 ? one : many}`;
const matches = (n: number) => plural(n, "match");

/** What was left alone, in words. Empty when nothing was. */
export function skippedText(r: ReplaceAllResult): string {
  const parts: string[] = [];
  const n = r.skipped.spanning;
  const m = r.skipped.notEditable;
  if (n) parts.push(`${matches(n)} ${n === 1 ? "runs" : "run"} across two pieces of text`);
  if (m) parts.push(`${matches(m)} ${m === 1 ? "is" : "are"} in text that cannot be edited`);
  return parts.length ? `Left as they are: ${parts.join("; ")}.` : "";
}

export interface ReplaceState {
  /** The replace row of the find bar is shown. */
  open: boolean;
  setOpen(open: boolean): void;
  text: string;
  setText(text: string): void;
  /** What the last replace did, for the bar. */
  message: string | null;
  busy: boolean;
  /** Asking "Replace all?": how many, and what would be left. */
  confirm: { query: string; result: ReplaceAllResult } | null;
  /** Replaces the match the find bar is on. */
  one(): Promise<void>;
  /** Counts what Replace all would do and asks. */
  all(): Promise<void>;
  /** Does it (after `all` asked). */
  confirmAll(): Promise<void>;
  cancel(): void;
}

/** The state of the replace row. `enabled` is false for a read-only viewer or one without the edit tool. */
export function useReplace(session: PdfSession, find: FindState, notices: Notices, enabled: boolean): ReplaceState {
  const [open, setOpenState] = useState(false);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ReplaceState["confirm"]>(null);
  const latest = useRef(find);
  latest.current = find;

  const options = () => ({ caseSensitive: latest.current.matchCase, wholeWord: latest.current.wholeWord });
  const guard = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      setMessage(`Could not replace. ${plainMessage(e)}`);
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const one = useCallback(async () => {
    if (!enabled) return;
    const f = latest.current;
    const hit = f.hits[f.current];
    if (!hit || !f.query.trim()) return;
    const r = hit.rects[0]!;
    await guard(async () => {
      const result = await session.content.replaceAll(f.query, text, { ...options(), at: { page: hit.page, x: r.x + r.w / 2, y: r.y + r.h / 2 } });
      if (result.replaced === 0) {
        setMessage("This match cannot be replaced: it runs across two pieces of text, is in text that cannot be edited, or was replaced already.");
        return;
      }
      setMessage("Replaced 1 match.");
      notices.show("Replaced 1 match", { ms: 4000, action: { label: "Undo", run: () => void session.undo() } });
      latest.current.next();
    });
  }, [enabled, session, text, notices]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = useCallback(async () => {
    if (!enabled) return;
    const query = latest.current.query;
    if (!query.trim()) return;
    await guard(async () => {
      const result = await session.content.replaceAll(query, text, { ...options(), dryRun: true });
      if (result.replaced === 0) {
        const left = skippedText(result);
        setMessage(`Nothing to replace. ${left || "No match could be replaced."}`.trim());
        return;
      }
      setConfirm({ query, result });
    });
  }, [enabled, session, text]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmAll = useCallback(async () => {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    await guard(async () => {
      const result = await session.content.replaceAll(c.query, text, options());
      const left = skippedText(result);
      setMessage(`Replaced ${matches(result.replaced)} on ${plural(result.pages.length, "page", "pages")}. ${left}`.trim());
      notices.show(`Replaced ${matches(result.replaced)}`, { ms: 6000, action: { label: "Undo", run: () => void session.undo() } });
    });
  }, [confirm, session, text, notices]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    open: open && enabled,
    setOpen: (v) => {
      setOpenState(v);
      if (!v) setMessage(null);
    },
    text,
    setText: (t) => {
      setText(t);
      setMessage(null);
    },
    message,
    busy,
    confirm,
    one,
    all,
    confirmAll,
    cancel: () => setConfirm(null),
  };
}

/** The second row of the find bar: what to put instead, and the buttons. */
export function ReplaceRow({ find, replace }: { find: FindState; replace: ReplaceState }) {
  const can = !replace.busy && !!find.query.trim();
  return (
    <div className="pli-pdf-replace" role="group" aria-label="Replace">
      <input
        className="pli-pdf-find-input"
        type="text"
        aria-label="Replace with"
        placeholder="Replace with"
        value={replace.text}
        onChange={(e) => replace.setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void replace.one();
          }
        }}
      />
      <button type="button" className="pli-button" aria-label="Replace" title="Replace this match" disabled={!can || find.hits.length === 0} onMouseDown={keepFocus} onClick={() => void replace.one()}>
        {I.replace}
        <span>Replace</span>
      </button>
      <button type="button" className="pli-button" aria-label="Replace all" title="Replace every match you can" disabled={!can || find.hits.length === 0} onMouseDown={keepFocus} onClick={() => void replace.all()}>
        {I.replaceAll}
        <span>Replace all</span>
      </button>
      {replace.message && (
        <p className="pli-pdf-replace-message" role="status">
          {replace.message}
        </p>
      )}
    </div>
  );
}

/** "Replace N matches?" with what would stay as it is. */
export function ReplaceDialog({ replace }: { replace: ReplaceState }) {
  const c = replace.confirm;
  const left = c ? skippedText(c.result) : "";
  return (
    <Dialog
      open={!!c}
      title="Replace all?"
      onClose={replace.cancel}
      onSubmit={() => void replace.confirmAll()}
      actions={
        <>
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button" onClick={replace.cancel}>
            Cancel
          </button>
          <button type="submit" className="pli-button pli-button-primary">
            Replace {c ? matches(c.result.replaced) : ""}
          </button>
        </>
      }
    >
      {c && (
        <>
          <p className="pli-dialog-note">
            Replace {matches(c.result.replaced)} of “{c.query}” with “{replace.text}” on {plural(c.result.pages.length, "page", "pages")}. You can undo this.
          </p>
          {left && <p className="pli-dialog-note">{left}</p>}
          <p className="pli-dialog-note">Replaced text is written as a text edit: see the Edits tab. The old text is cut out of the page when the file is saved.</p>
        </>
      )}
    </Dialog>
  );
}
