import { useContext, useEffect, useRef, useState } from "react";
import { DEFAULT_PAGE, PAGE_SIZES, type ImageBlock, type PageSetup, type PageSize, type ColumnSetup, type Columns, type ParagraphFormat, type ParagraphFormatPatch } from "@pli.dev/docs";
import { imageBlockFromFile, imageBlockFromUrl } from "../images";
import { Dialog } from "./primitives";
import { FilePickerContext, pickWith } from "./file-picker";

export interface LinkDialogProps {
  open: boolean;
  /** The link on the selected text, if any. */
  initialUrl?: string;
  /** With no text selected, a label is needed for the new link. */
  askForText: boolean;
  onApply: (url: string, text?: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Only these schemes are offered; the editor also refuses to render others as links. */
function normalizeUrl(input: string): string {
  const url = input.trim();
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(url)) return url;
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(url)) return `mailto:${url}`;
  return `https://${url}`;
}

export function LinkDialog({ open, initialUrl, askForText, onApply, onRemove, onClose }: LinkDialogProps) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [text, setText] = useState("");
  const apply = () => {
    if (!url.trim()) return;
    onApply(normalizeUrl(url), askForText ? text.trim() || undefined : undefined);
    onClose();
  };
  return (
    <Dialog
      open={open}
      title="Link"
      onClose={onClose}
      onSubmit={apply}
      actions={
        <>
          {initialUrl && (
            <button type="button" className="pli-button pli-button-danger" onClick={() => { onRemove(); onClose(); }}>
              Remove link
            </button>
          )}
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary" disabled={!url.trim()}>Apply</button>
        </>
      }
    >
      {askForText && (
        <label className="pli-field-row">
          <span>Text</span>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Link text" />
        </label>
      )}
      <label className="pli-field-row">
        <span>Link</span>
        <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste or type a URL" autoFocus />
      </label>
    </Dialog>
  );
}

export interface ImageDialogProps {
  open: boolean;
  maxWidth: number;
  onInsert: (block: ImageBlock) => void;
  /**
   * Called with a file chosen from the computer, instead of reading it into a data URI here. Use it to
   * hand the file to the editor, which uploads it to the session's storage if there is one.
   */
  onFile?: (file: File) => Promise<void> | void;
  onClose: () => void;
}

export function ImageDialog({ open, maxWidth, onInsert, onFile, onClose }: ImageDialogProps) {
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const picker = useContext(FilePickerContext);

  const run = async (make: () => Promise<ImageBlock | void>) => {
    setBusy(true);
    setError(null);
    try {
      const block = await make();
      if (block) onInsert(block);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The image could not be inserted.");
    } finally {
      setBusy(false);
    }
  };

  const insertFile = (file: File) => run(() => (onFile ? Promise.resolve(onFile(file)) : imageBlockFromFile(file, { maxWidth })));
  const upload = () => {
    if (!picker) return fileInput.current?.click();
    void pickWith(picker, { purpose: "image", accept: "image/*", label: "Insert an image" }).then(([file]) => file && insertFile(file));
  };

  return (
    <Dialog
      open={open}
      title="Insert image"
      onClose={onClose}
      onSubmit={() => url.trim() && run(() => imageBlockFromUrl(url.trim(), { maxWidth, alt: alt || undefined }))}
      actions={
        <>
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary" disabled={busy || !url.trim()}>
            Insert from URL
          </button>
        </>
      }
    >
      <div className="pli-upload">
        <button type="button" className="pli-button pli-button-primary" disabled={busy} onClick={upload}>
          Upload from computer…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void insertFile(file);
          }}
        />
      </div>
      <p className="pli-dialog-or">or use a link</p>
      <label className="pli-field-row">
        <span>Image URL</span>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
      </label>
      <label className="pli-field-row">
        <span>Description</span>
        <input type="text" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="For screen readers (optional)" />
      </label>
      <p className="pli-dialog-note">You can also paste an image or drop one into the document.</p>
      {error && <p className="pli-dialog-error" role="alert">{error}</p>}
    </Dialog>
  );
}

export interface PageSetupDialogProps {
  open: boolean;
  /** The page setup of the section being changed. */
  page: PageSetup;
  /** When the document has more than one section, the dialog asks which to change. `current` is the one the caret is in. */
  sections?: { count: number; current: number };
  /** `scope` is `"document"` or the number of a section. */
  onApply: (page: PageSetup, scope: "document" | number) => void;
  onClose: () => void;
}

export function PageSetupDialog({ open, page, sections, onApply, onClose }: PageSetupDialogProps) {
  const [draft, setDraft] = useState<PageSetup>(page);
  const several = (sections?.count ?? 1) > 1;
  const [scope, setScope] = useState<"document" | number>("document");
  useEffect(() => {
    if (!open) return;
    setDraft(page);
    setScope(several ? sections!.current : "document");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read when the dialog opens
  }, [open]);
  const margin = (side: keyof PageSetup["margins"], label: string) => (
    <label className="pli-field-row pli-field-narrow">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={5}
        step={0.1}
        value={draft.margins[side]}
        onChange={(e) => {
          const value = Math.min(5, Math.max(0, Number(e.target.value) || 0));
          setDraft({ ...draft, margins: { ...draft.margins, [side]: value } });
        }}
      />
    </label>
  );
  return (
    <Dialog
      open={open}
      title="Page setup"
      onClose={onClose}
      onSubmit={() => { onApply(draft, scope); onClose(); }}
      actions={
        <>
          <button type="button" className="pli-button" onClick={() => setDraft(DEFAULT_PAGE)}>Reset</button>
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">OK</button>
        </>
      }
    >
      {several && (
        <fieldset className="pli-radio-row">
          <legend>Apply to</legend>
          <label>
            <input type="radio" name="scope" checked={scope === "document"} onChange={() => setScope("document")} />
            Whole document
          </label>
          <label>
            <input type="radio" name="scope" checked={scope !== "document"} onChange={() => setScope(sections!.current)} />
            This section ({sections!.current + 1})
          </label>
        </fieldset>
      )}
      <label className="pli-field-row">
        <span>Paper size</span>
        <select value={draft.size} onChange={(e) => setDraft({ ...draft, size: e.target.value as PageSize })}>
          {(Object.keys(PAGE_SIZES) as PageSize[]).map((size) => (
            <option key={size} value={size}>{PAGE_SIZES[size].label}</option>
          ))}
        </select>
      </label>
      <fieldset className="pli-radio-row">
        <legend>Orientation</legend>
        {(["portrait", "landscape"] as const).map((o) => (
          <label key={o}>
            <input type="radio" name="orientation" checked={draft.orientation === o} onChange={() => setDraft({ ...draft, orientation: o })} />
            {o === "portrait" ? "Portrait" : "Landscape"}
          </label>
        ))}
      </fieldset>
      <fieldset className="pli-margins">
        <legend>Margins (inches)</legend>
        {margin("top", "Top")}
        {margin("bottom", "Bottom")}
        {margin("left", "Left")}
        {margin("right", "Right")}
      </fieldset>
      <fieldset className="pli-radio-row">
        <legend>Headers and footers</legend>
        {([["differentFirstPage", "Different first page"], ["differentOddEven", "Different odd and even pages"]] as const).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={!!draft[key]}
              onChange={(e) => {
                const { [key]: _old, ...rest } = draft;
                setDraft(e.target.checked ? { ...rest, [key]: true } : rest);
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
    </Dialog>
  );
}

export interface ParagraphDialogProps {
  open: boolean;
  /** The selected paragraph's current format. */
  format: ParagraphFormat;
  onApply: (patch: ParagraphFormatPatch) => void;
  onClose: () => void;
}

interface ParagraphDraft {
  left: string;
  right: string;
  special: "none" | "first" | "hanging";
  by: string;
  before: string;
  after: string;
  line: string;
}

const PT = 72;
const toInches = (pt: number | undefined) => (pt ? String(Math.round((pt / PT) * 100) / 100) : "0");
const num = (text: string, fallback = 0) => (Number.isFinite(Number(text)) && text.trim() !== "" ? Number(text) : fallback);

function draftOf(f: ParagraphFormat): ParagraphDraft {
  const first = f.indentFirst ?? 0;
  return {
    left: toInches(f.indentLeft),
    right: toInches(f.indentRight),
    special: first > 0 ? "first" : first < 0 ? "hanging" : "none",
    by: toInches(Math.abs(first)),
    before: f.spaceBefore === undefined ? "" : String(f.spaceBefore),
    after: f.spaceAfter === undefined ? "" : String(f.spaceAfter),
    line: String(f.lineHeight ?? 1.15),
  };
}

/** Indents (in inches), spacing before and after (in points) and line spacing for the selected paragraphs. */
export function ParagraphDialog({ open, format, onApply, onClose }: ParagraphDialogProps) {
  const [draft, setDraft] = useState<ParagraphDraft>(() => draftOf(format));
  useEffect(() => {
    if (open) setDraft(draftOf(format));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read when the dialog opens, not as the document changes under it
  }, [open]);

  const field = (key: keyof ParagraphDraft, label: string, props: { min?: number; max?: number; step?: number; placeholder?: string } = {}) => (
    <label className="pli-field-row pli-field-narrow">
      <span>{label}</span>
      <input type="number" value={draft[key]} {...props} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
    </label>
  );

  const apply = () => {
    const by = Math.max(0, num(draft.by)) * PT;
    const first = draft.special === "first" ? by : draft.special === "hanging" ? -by : 0;
    // A hanging indent needs room: the first line can't start left of the margin.
    const left = Math.max(0, num(draft.left) * PT, first < 0 ? -first : 0);
    const pts = (text: string) => (text.trim() === "" ? null : Math.max(0, num(text)));
    const line = num(draft.line, 1.15);
    onApply({
      indentLeft: left || null,
      indentRight: Math.max(0, num(draft.right) * PT) || null,
      indentFirst: first || null,
      spaceBefore: pts(draft.before),
      spaceAfter: pts(draft.after),
      lineHeight: Math.abs(line - 1.15) < 0.001 ? null : Math.min(10, Math.max(0.5, line)),
    });
    onClose();
  };

  return (
    <Dialog
      open={open}
      title="Paragraph"
      onClose={onClose}
      onSubmit={apply}
      actions={
        <>
          <button type="button" className="pli-button" onClick={() => setDraft(draftOf({}))}>Reset</button>
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">OK</button>
        </>
      }
    >
      <fieldset className="pli-margins">
        <legend>Indentation (inches)</legend>
        {field("left", "Left", { min: 0, max: 10, step: 0.0625 })}
        {field("right", "Right", { min: 0, max: 10, step: 0.0625 })}
        <label className="pli-field-row pli-field-narrow">
          <span>Special</span>
          <select value={draft.special} onChange={(e) => setDraft({ ...draft, special: e.target.value as ParagraphDraft["special"] })}>
            <option value="none">None</option>
            <option value="first">First line</option>
            <option value="hanging">Hanging</option>
          </select>
        </label>
        {draft.special !== "none" && field("by", "By", { min: 0, max: 10, step: 0.0625 })}
      </fieldset>
      <fieldset className="pli-margins">
        <legend>Spacing</legend>
        {field("before", "Before (pt)", { min: 0, max: 200, step: 1, placeholder: "Default" })}
        {field("after", "After (pt)", { min: 0, max: 200, step: 1, placeholder: "Default" })}
        {field("line", "Line spacing", { min: 0.5, max: 10, step: 0.05 })}
      </fieldset>
    </Dialog>
  );
}

export interface ColumnsDialogProps {
  open: boolean;
  /** The columns of the section the caret is in. */
  columns: ColumnSetup;
  /** True when something is selected, so the columns apply to just that text. */
  hasSelection: boolean;
  onApply: (columns: Columns | null) => void;
  onClose: () => void;
}

/** How many columns, the space between them and whether a line is drawn between them. */
export function ColumnsDialog({ open, columns, hasSelection, onApply, onClose }: ColumnsDialogProps) {
  const [count, setCount] = useState(columns.count);
  const [gap, setGap] = useState(String(Math.round((columns.gap / 72) * 100) / 100));
  const [rule, setRule] = useState(columns.rule);
  useEffect(() => {
    if (!open) return;
    setCount(columns.count);
    setGap(String(Math.round((columns.gap / 72) * 100) / 100));
    setRule(columns.rule);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read when the dialog opens
  }, [open]);

  const apply = () => {
    const inches = Number.isFinite(Number(gap)) && gap.trim() !== "" ? Math.min(2, Math.max(0, Number(gap))) : 0.5;
    onApply(count > 1 ? { count, gap: Math.round(inches * 72), ...(rule && { rule: true }) } : null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      title="Columns"
      onClose={onClose}
      onSubmit={apply}
      actions={
        <>
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">Apply</button>
        </>
      }
    >
      <fieldset className="pli-radio-row">
        <legend>Number of columns</legend>
        {[1, 2, 3, 4].map((n) => (
          <label key={n}>
            <input type="radio" name="columns" checked={count === n} onChange={() => setCount(n)} />
            {n === 1 ? "One" : n === 2 ? "Two" : n === 3 ? "Three" : "Four"}
          </label>
        ))}
      </fieldset>
      <label className="pli-field-row pli-field-narrow">
        <span>Space between (in)</span>
        <input type="number" min={0} max={2} step={0.05} value={gap} disabled={count < 2} onChange={(e) => setGap(e.target.value)} />
      </label>
      <label className="pli-checkbox-row">
        <input type="checkbox" checked={rule} disabled={count < 2} onChange={(e) => setRule(e.target.checked)} />
        Line between columns
      </label>
      <p className="pli-dialog-note">
        {hasSelection
          ? "Applies to the selected text. Section breaks are added around it."
          : "Applies to the section the caret is in: the whole document, unless it has section breaks."}
      </p>
    </Dialog>
  );
}
