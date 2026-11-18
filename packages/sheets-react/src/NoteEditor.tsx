import { useEffect, useRef, useState } from "react";
import { Dialog, keepFocus, FileInput } from "@pli.dev/react";
import { MAX_NOTE_LENGTH, NOTE_DASHES, NOTE_FILL, NOTE_FONT, NOTE_FONT_SIZE, NOTE_LINE_WEIGHT, editNoteRuns, linkInText, noteLookOf, noteRunsAllHave, noteRunsOf, spliceNoteRuns, styleNoteRuns, type NoteBox, type NoteDash, type NoteInfo, type NoteRun, type NoteRunStyle } from "@pli.dev/sheets";
import { imageFromFile } from "./imageFile";
import { insertText, readRuns, renderRuns, runsFromHtml, selectOffsets, selectionOffsets } from "./noteDom";

export interface NoteDialogResult {
  text: string;
  /** The look of parts of the text, when any has one. */
  runs?: NoteRun[];
  /** Keep the note showing on the sheet. */
  show: boolean;
  /** The look of the note's box: fill, transparency, picture, line, weight, dash and shadow (only what isn't Excel's usual). */
  look: Partial<NoteBox>;
}

export interface NoteDialogProps {
  open: boolean;
  /** The cell's note, or null for a new one. */
  note: NoteInfo | null;
  cell: string;
  /** Who a new note will be by, if the host said. */
  author?: string | undefined;
  onClose(): void;
  /** Returns why it was refused, if it was. */
  onSave(result: NoteDialogResult): string | void;
  onDelete?(): void;
}

export const NOTE_FONTS = [NOTE_FONT, "Arial", "Calibri", "Georgia", "Times New Roman", "Courier New", "Verdana"];
export const NOTE_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24, 36];

/** The editor's own background, following the box's fill or picture so it shows how the note will look. */
function editorFill(look: Partial<NoteBox>): React.CSSProperties | undefined {
  if (look.fill === undefined && look.picture === undefined) return undefined;
  return { backgroundColor: look.fill ?? NOTE_FILL, ...(look.picture ? { backgroundImage: `url("${look.picture}")`, backgroundSize: "100% 100%" } : {}) };
}

const isFormatted = (r: NoteRun) => Object.keys(r).length > 1;

const DASH_LABELS: Record<NoteDash, string> = {
  solid: "Solid", dot: "Dots", dash: "Dashes", dashDot: "Dash dot", longDash: "Long dashes", longDashDot: "Long dash dot", longDashDotDot: "Long dash dot dot",
  shortDash: "Short dashes", shortDot: "Short dots", shortDashDot: "Short dash dot", shortDashDotDot: "Short dash dot dot",
};

/** The address every character from `from` to `to` leads to: undefined when there is none, null when they differ. */
function linkOver(runs: readonly NoteRun[], from: number, to: number): string | null | undefined {
  let at = 0;
  let found: string | null | undefined;
  for (const run of runs) {
    const end = at + run.text.length;
    if (Math.min(to, end) > Math.max(from, at)) {
      if (found === undefined) found = run.link;
      else if (found !== run.link) return null;
    }
    at = end;
  }
  return found;
}

/** Where the link round a point in the text begins and ends, if there is one. */
function linkAround(runs: readonly NoteRun[], offset: number): { from: number; to: number; link: string } | null {
  let at = 0;
  for (const run of runs) {
    const end = at + run.text.length;
    if (run.link && offset >= at && offset <= end) return { from: at, to: end, link: run.link };
    at = end;
  }
  return null;
}

/** Writes, changes or deletes a cell's note: text with a small toolbar for bold, italic, underline, strikethrough, a font, a size and a colour. */
export function NoteDialog({ open, note, cell, author, onClose, onSave, onDelete }: NoteDialogProps) {
  const editor = useRef<HTMLDivElement>(null);
  /** The selection the toolbar works on: the last one that was in the editor (clicking a list or the colour picker leaves it). */
  const picked = useRef<{ from: number; to: number } | null>(null);
  const [show, setShow] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [look, setLook] = useState({ bold: false, italic: false, underline: false, strike: false });
  /** The look the next typed characters get, when the caret is on a point and a button was pressed (Excel's way: format, then type). */
  const pending = useRef<{ at: number; patch: NoteRunStyle } | null>(null);
  const [linkRow, setLinkRow] = useState<string | null>(null);
  const [boxLook, setBoxLook] = useState<Partial<NoteBox>>({});

  useEffect(() => {
    if (!open) return;
    const root = editor.current;
    if (!root) return;
    renderRuns(root, note ? noteRunsOf({ note: note.text, ...(note.runs ? { noteRuns: note.runs } : {}) }) : []);
    setShow(!!note?.box?.show);
    setBoxLook(noteLookOf(note?.box));
    setLinkRow(null);
    pending.current = null;
    setProblem(null);
    picked.current = null;
    root.focus();
    const end = readRuns(root).text.length;
    selectOffsets(root, end, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // What the toolbar shows follows the selection.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const root = editor.current;
      const sel = root && selectionOffsets(root);
      if (!root || !sel) return;
      picked.current = sel;
      if (pending.current && (sel.from !== sel.to || sel.from !== pending.current.at)) pending.current = null;
      const { text, runs } = readRuns(root);
      // On a point, the buttons show the look of the character before it (or after it, at the start), and then what was pressed.
      const span = sel.from !== sel.to ? [sel.from, sel.to] : sel.from > 0 ? [sel.from - 1, sel.from] : [0, 1];
      const at = (flag: "bold" | "italic" | "underline" | "strike") => {
        const p = pending.current?.patch[flag];
        return p !== undefined ? !!p : noteRunsAllHave(text, runs, span[0]!, span[1]!, flag);
      };
      setLook({ bold: at("bold"), italic: at("italic"), underline: at("underline"), strike: at("strike") });
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [open]);

  /** Gives the selected text a look; `patch` is worked out from what is there (so a toggle can see whether it is on). */
  const apply = (patch: (text: string, runs: NoteRun[], from: number, to: number, on: { from: number; to: number }) => NoteRunStyle) => {
    const root = editor.current;
    const sel = (root && selectionOffsets(root)) || picked.current;
    if (!root || !sel) return;
    if (sel.from === sel.to) {
      // Nothing is selected: the look goes to what is typed next.
      const { text, runs } = readRuns(root);
      const from = Math.max(0, sel.from - 1);
      const asked = patch(text, runs, from, Math.max(sel.from, 1), sel);
      pending.current = { at: sel.from, patch: { ...(pending.current?.at === sel.from ? pending.current.patch : {}), ...asked } };
      setLook((l) => ({ ...l, ...Object.fromEntries((["bold", "italic", "underline", "strike"] as const).filter((k) => asked[k] !== undefined).map((k) => [k, !!asked[k]])) }));
      root.focus();
      return;
    }
    const { text, runs } = readRuns(root);
    const next = styleNoteRuns(text, runs, sel.from, sel.to, patch(text, runs, sel.from, sel.to, sel));
    renderRuns(root, next ?? [{ text }]);
    root.focus();
    selectOffsets(root, sel.from, sel.to);
    picked.current = sel;
    const flags = { bold: false, italic: false, underline: false, strike: false };
    for (const k of Object.keys(flags) as (keyof typeof flags)[]) flags[k] = noteRunsAllHave(text, next, sel.from, sel.to, k);
    setLook(flags);
  };
  const toggle = (flag: "bold" | "italic" | "underline" | "strike") =>
    apply((text, runs, from, to, sel) => {
      const waiting = sel.from === sel.to && pending.current?.at === sel.from ? pending.current.patch[flag] : undefined;
      return { [flag]: waiting !== undefined ? !waiting : !noteRunsAllHave(text, runs, from, to, flag) };
    });

  /** Typing on a point after a button was pressed: the characters get the look that was asked for. */
  useEffect(() => {
    if (!open) return;
    const root = editor.current;
    if (!root) return;
    const onBeforeInput = (e: Event) => {
      const ev = e as InputEvent;
      const wait = pending.current;
      const sel = selectionOffsets(root);
      if (!wait || !sel || ev.inputType !== "insertText" || !ev.data || sel.from !== wait.at) return;
      ev.preventDefault();
      const { text, runs } = readRuns(root);
      const made = editNoteRuns(text, runs, [{ start: sel.from, end: sel.to, text: ev.data }]);
      const to = sel.from + ev.data.length;
      const styled = styleNoteRuns(made.note, made.runs, sel.from, to, wait.patch);
      renderRuns(root, styled ?? [{ text: made.note }]);
      pending.current = { at: to, patch: wait.patch };
      selectOffsets(root, to, to);
    };
    root.addEventListener("beforeinput", onBeforeInput);
    return () => root.removeEventListener("beforeinput", onBeforeInput);
  }, [open]);

  // ---- links in the text ----
  const openLinkRow = () => {
    const root = editor.current;
    const sel = (root && selectionOffsets(root)) || picked.current;
    if (!root || !sel) return;
    const { runs } = readRuns(root);
    const around = sel.from === sel.to ? linkAround(runs, sel.from) : null;
    if (sel.from === sel.to && !around) return setProblem("Select the words to link first.");
    setProblem(null);
    picked.current = around ? { from: around.from, to: around.to } : sel;
    setLinkRow(linkOver(runs, picked.current.from, picked.current.to) ?? "");
  };
  const setLink = (to: string | null) => {
    const root = editor.current;
    const sel = picked.current;
    if (!root || !sel) return;
    const { text, runs } = readRuns(root);
    const address = to === null ? null : (linkInText(to) ?? to.trim());
    if (address === "") return setProblem("Type the address to link to.");
    let next: NoteRun[] | undefined;
    try {
      next = styleNoteRuns(text, runs, sel.from, sel.to, { link: address });
    } catch (e) {
      return setProblem((e as Error).message);
    }
    renderRuns(root, next ?? [{ text }]);
    setProblem(null);
    setLinkRow(null);
    root.focus();
    selectOffsets(root, sel.from, sel.to);
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { src } = await imageFromFile(file);
      setBoxLook((l) => ({ ...l, picture: src }));
      setProblem(null);
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  /** Changes one property of the box's look; `undefined` puts it back to Excel's usual. */
  const setBox = <K extends keyof NoteBox>(key: K, value: NoteBox[K] | undefined) =>
    setBoxLook((l) => {
      const next: Record<string, unknown> = { ...l };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next as Partial<NoteBox>;
    });

  const save = () => {
    const root = editor.current;
    if (!root) return;
    const { text, runs } = readRuns(root);
    if (text.length > MAX_NOTE_LENGTH) return setProblem(`A note can be at most ${MAX_NOTE_LENGTH} characters.`);
    const refused = onSave({ text, ...(runs.some(isFormatted) ? { runs } : {}), show, look: boxLook });
    if (refused) setProblem(refused);
  };

  const shortcut = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // the grid behind must not hear typing
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "b" || k === "i" || k === "u" || k === "5") {
      e.preventDefault();
      toggle(k === "b" ? "bold" : k === "i" ? "italic" : k === "u" ? "underline" : "strike");
    } else if (k === "k") {
      e.preventDefault();
      openLinkRow();
    } else if (k === "enter") {
      e.preventDefault();
      save();
    }
  };

  const tool = (label: string, shown: string, flag: "bold" | "italic" | "underline" | "strike", title: string) => (
    <button type="button" className="pli-tool pli-note-tool" aria-label={label} aria-pressed={look[flag]} title={title} data-flag={flag} onMouseDown={keepFocus} onClick={() => toggle(flag)}>
      {shown}
    </button>
  );

  return (
    <Dialog
      open={open}
      title={note === null ? `New note on ${cell}` : `Note on ${cell}`}
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          {note !== null && onDelete && <button type="button" className="pli-button" onClick={onDelete}>Delete note</button>}
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">Save</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform">
        {(note?.author ?? author) && <div className="pli-note-author">By {note?.author ?? author}</div>}
        <div className="pli-note-toolbar" role="toolbar" aria-label="Note formatting">
          {tool("Bold", "B", "bold", "Bold (Ctrl or Cmd+B)")}
          {tool("Italic", "I", "italic", "Italic (Ctrl or Cmd+I)")}
          {tool("Underline", "U", "underline", "Underline (Ctrl or Cmd+U)")}
          {tool("Strikethrough", "S", "strike", "Strikethrough (Ctrl or Cmd+5)")}
          <select aria-label="Font" defaultValue="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) apply(() => ({ font: v === NOTE_FONT ? null : v })); }}>
            <option value="">Font</option>
            {NOTE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select aria-label="Size" defaultValue="" onChange={(e) => { const v = Number(e.target.value); e.target.value = ""; if (v) apply(() => ({ size: v === NOTE_FONT_SIZE ? null : v })); }}>
            <option value="">Size</option>
            {NOTE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <input type="color" aria-label="Text colour" title="Text colour" defaultValue="#000000" onChange={(e) => apply(() => ({ color: e.target.value }))} />
          <button type="button" className="pli-tool pli-note-tool" aria-label="Clear formatting" title="Clear formatting" onMouseDown={keepFocus} onClick={() => apply(() => ({ bold: false, italic: false, underline: false, strike: false, color: null, size: null, font: null }))}>
            {"✕"}
          </button>
          <button type="button" className="pli-tool pli-note-tool" aria-label="Link" title="Link the selected words (Ctrl or Cmd+K)" aria-pressed={linkRow !== null} onMouseDown={keepFocus} onClick={openLinkRow}>
            Link
          </button>
        </div>
        {linkRow !== null && (
          <div className="pli-note-linkrow" role="group" aria-label="Link the selected words">
            <input
              type="text"
              aria-label="Link address"
              placeholder="https://… , mailto:… or #Sheet1!A1"
              value={linkRow}
              autoFocus
              onChange={(e) => setLinkRow(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  setLink(linkRow);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setLinkRow(null);
                  editor.current?.focus();
                }
              }}
            />
            <button type="button" className="pli-button" onClick={() => setLink(linkRow)}>Link</button>
            <button type="button" className="pli-button" onClick={() => setLink(null)}>Remove link</button>
            <button type="button" className="pli-button" onClick={() => { setLinkRow(null); editor.current?.focus(); }}>Cancel</button>
          </div>
        )}
        <div
          ref={editor}
          className="pli-note-editor"
          role="textbox"
          aria-multiline="true"
          aria-label="Note"
          contentEditable
          suppressContentEditableWarning
          spellCheck
          style={editorFill(boxLook)}
          onKeyDown={shortcut}
          onPaste={(e) => {
            e.preventDefault();
            const root = editor.current;
            if (!root) return;
            const plain = e.clipboardData.getData("text/plain");
            const html = e.clipboardData.getData("text/html");
            const sel = selectionOffsets(root);
            // A web address on its own becomes a link; formatted text keeps its look and links (Excel's notes keep bold, colour…).
            const address = linkInText(plain);
            const pasted: NoteRun[] = address && sel && sel.from !== sel.to ? [{ text: plain.trim(), link: address }] : html ? runsFromHtml(html) : [];
            if (!sel || (!pasted.length && !html && !address) || (html && !pasted.length)) return void insertText(root, plain);
            const { text, runs } = readRuns(root);
            const made = spliceNoteRuns(text, runs, sel.from, sel.to, pasted.length ? pasted : [{ text: plain }]);
            renderRuns(root, made.runs ?? [{ text: made.note }]);
            const end = sel.from + pasted.reduce((n, r) => n + r.text.length, 0);
            selectOffsets(root, end, end);
          }}
        />
        <label className="pli-findbar-check">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Keep this note showing
        </label>
        <details className="pli-note-looks">
          <summary>Box: fill, picture, line and shadow</summary>
          <div className="pli-note-lookgrid">
            <label>Fill colour <input type="color" aria-label="Fill colour" value={boxLook.fill ?? NOTE_FILL} onChange={(e) => setBox("fill", e.target.value === NOTE_FILL ? undefined : e.target.value)} /></label>
            <label>Transparency (%) <input type="number" aria-label="Transparency" min={0} max={100} step={5} value={boxLook.transparency ?? 0} onChange={(e) => setBox("transparency", Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))) || undefined)} /></label>
            <label className="pli-note-picturefield">
              Picture
              <FileInput purpose="image" label="Fill picture" accept="image/png,image/jpeg,image/gif" onFiles={([file]) => void chooseFile(file)} />
            </label>
            {boxLook.picture && (
              <span className="pli-note-picturefield">
                <img className="pli-note-thumb" alt="The picture that fills the box" src={boxLook.picture} />
                <button type="button" className="pli-button" onClick={() => setBox("picture", undefined)}>Remove picture</button>
              </span>
            )}
            <label>Line colour <input type="color" aria-label="Line colour" value={boxLook.line && boxLook.line !== "none" ? boxLook.line : "#000000"} disabled={boxLook.line === "none"} onChange={(e) => setBox("line", e.target.value === "#000000" ? undefined : e.target.value)} /></label>
            <label className="pli-findbar-check"><input type="checkbox" aria-label="No line" checked={boxLook.line === "none"} onChange={(e) => setBox("line", e.target.checked ? "none" : undefined)} /> No line</label>
            <label>Weight (pt) <input type="number" aria-label="Line weight" min={0.25} max={100} step={0.25} value={boxLook.lineWeight ?? NOTE_LINE_WEIGHT} disabled={boxLook.line === "none"} onChange={(e) => setBox("lineWeight", Number(e.target.value) > 0 ? Number(e.target.value) : undefined)} /></label>
            <label>Dashes <select aria-label="Line dashes" value={boxLook.dash ?? "solid"} disabled={boxLook.line === "none"} onChange={(e) => setBox("dash", e.target.value === "solid" ? undefined : (e.target.value as NoteDash))}>
              {NOTE_DASHES.map((d) => <option key={d} value={d}>{DASH_LABELS[d]}</option>)}
            </select></label>
            <label className="pli-findbar-check"><input type="checkbox" aria-label="Shadow" checked={boxLook.shadow !== false} onChange={(e) => setBox("shadow", e.target.checked ? undefined : false)} /> Shadow</label>
            <button type="button" className="pli-button" onClick={() => setBoxLook({})}>Usual look</button>
          </div>
        </details>
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
