import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@pli.dev/react";
import { parseRanges, type SplitSpec } from "@pli.dev/pdf";
import { EDITS_NOTE, type FileActions, type SaveChoice } from "./fileActions";
import { rangeText, type NumberingStyle, type PageTools } from "./pageTools";
import { plainMessage, useStore } from "./store";

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const messageOf = plainMessage;

/** "1.4 MB" */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Buttons({ close, label, disabled, danger }: { close: () => void; label: string; disabled?: boolean; danger?: boolean }) {
  return (
    <>
      <span className="pli-spacer-flex" />
      <button type="button" className="pli-button" onClick={close}>
        Cancel
      </button>
      <button type="submit" className={danger ? "pli-button pli-button-primary pli-pdf-danger" : "pli-button pli-button-primary"} disabled={disabled}>
        {label}
      </button>
    </>
  );
}

// ---- page dialogs -----------------------------------------------------------------------------------------------------

/** The dialogs the page tools open (delete, password, extract, split, labels, move). */
export function PageDialogs({ tools }: { tools: PageTools }) {
  useStore(tools);
  const d = tools.dialog;
  if (!d) return null;
  switch (d.type) {
    case "delete":
      return <DeleteDialog tools={tools} ids={d.ids} items={d.items} />;
    case "password":
      return <PasswordDialog tools={tools} fileName={d.fileName} error={d.error} />;
    case "extract":
      return <ExtractDialog tools={tools} />;
    case "split":
      return <SplitDialog tools={tools} />;
    case "labels":
      return <LabelsDialog tools={tools} />;
    case "move":
      return <MoveDialog tools={tools} />;
  }
}

function DeleteDialog({ tools, ids, items }: { tools: PageTools; ids: string[]; items: number }) {
  const close = () => tools.closeDialog();
  return (
    <Dialog
      open
      title={`Delete ${plural(ids.length, "page")}?`}
      onClose={close}
      onSubmit={() => {
        tools.closeDialog();
        tools.remove(ids);
      }}
      actions={<Buttons close={close} label="Delete" danger />}
    >
      <p className="pli-dialog-note">
        {ids.length === 1 ? "This page" : "These pages"} will be taken out of the document
        {items > 0 ? `, together with ${plural(items, "annotation or form field")} on ${ids.length === 1 ? "it" : "them"}` : ""}. You can undo this.
      </p>
    </Dialog>
  );
}

function PasswordDialog({ tools, fileName, error }: { tools: PageTools; fileName: string; error?: string }) {
  const [password, setPassword] = useState("");
  return (
    <Dialog
      open
      title="Password needed"
      onClose={() => tools.answerPassword(null)}
      onSubmit={() => tools.answerPassword(password)}
      actions={
        <>
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button" onClick={() => tools.answerPassword(null)}>
            Skip this file
          </button>
          <button type="submit" className="pli-button pli-button-primary" disabled={password === ""}>
            Add pages
          </button>
        </>
      }
    >
      <p className="pli-dialog-note">{fileName} is protected with a password.</p>
      <label className="pli-field-row">
        <span>Password</span>
        <input type="password" aria-label="Password" autoFocus autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && (
        <p className="pli-dialog-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function idsOfRanges(tools: PageTools, text: string): string[] {
  const ids = tools.pages.map((p) => p.id);
  return parseRanges(text, ids.length).flatMap(([a, b]) => ids.slice(a - 1, b));
}

function ExtractDialog({ tools }: { tools: PageTools }) {
  const [text, setText] = useState(() => rangeText(tools.positions(tools.selected())));
  const [remove, setRemove] = useState(false);
  let ids: string[] = [];
  let error: string | null = null;
  try {
    ids = text.trim() ? idsOfRanges(tools, text) : [];
  } catch (e) {
    error = messageOf(e);
  }
  const unique = tools.inOrder(ids);
  const close = () => tools.closeDialog();
  return (
    <Dialog
      open
      title="Extract pages"
      onClose={close}
      onSubmit={() => {
        if (unique.length === 0) return;
        tools.closeDialog();
        void tools.extract(unique, { remove });
      }}
      actions={<Buttons close={close} label="Extract" disabled={unique.length === 0 || error !== null} />}
    >
      <p className="pli-dialog-note">Makes a new PDF of these pages. This document stays as it is.</p>
      <label className="pli-field-row">
        <span>Pages</span>
        <input type="text" aria-label="Pages to extract" autoFocus value={text} placeholder="1-3, 5" onChange={(e) => setText(e.target.value)} />
      </label>
      {error ? (
        <p className="pli-dialog-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="pli-dialog-note">{unique.length === 0 ? "Type page numbers, such as 1-3, 5." : `${plural(unique.length, "page")} of ${tools.pages.length}.`}</p>
      )}
      {!tools.readOnly && (
        <label className="pli-radio-row">
          <input type="checkbox" checked={remove} disabled={unique.length >= tools.pages.length} onChange={(e) => setRemove(e.target.checked)} /> Also delete them from this document
        </label>
      )}
    </Dialog>
  );
}

type SplitMode = "ranges" | "every" | "outline";

function SplitDialog({ tools }: { tools: PageTools }) {
  const [mode, setMode] = useState<SplitMode>("every");
  const [ranges, setRanges] = useState("");
  const [every, setEvery] = useState(1);
  const [level, setLevel] = useState(1);
  const [zip, setZip] = useState(true);
  const spec: SplitSpec | null = mode === "ranges" ? (ranges.trim() ? { ranges } : null) : mode === "every" ? { every } : { outline: level };
  let plan: string[] = [];
  let error: string | null = null;
  if (spec) {
    try {
      plan = tools.planSplit(spec);
    } catch (e) {
      error = messageOf(e);
    }
  }
  const hasBookmarks = tools.session.doc.outline.length > 0;
  const close = () => tools.closeDialog();
  const choice = (id: SplitMode, label: string, body?: ReactNode) => (
    <div className="pli-field-row">
      <label className="pli-radio-row">
        <input type="radio" name="split-mode" checked={mode === id} onChange={() => setMode(id)} /> {label}
      </label>
      {body}
    </div>
  );
  return (
    <Dialog
      open
      title="Split document"
      onClose={close}
      onSubmit={() => {
        if (!spec || error || plan.length === 0) return;
        tools.closeDialog();
        void tools.split(spec, { zip });
      }}
      actions={<Buttons close={close} label={plan.length > 1 ? `Split into ${plan.length} files` : "Split"} disabled={!spec || error !== null || plan.length === 0} />}
    >
      {choice("every", "Every", <span><input type="number" min={1} aria-label="Pages in each file" value={every} disabled={mode !== "every"} onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))} /> pages</span>)}
      {choice("ranges", "Page ranges", <input type="text" aria-label="Page ranges" placeholder="1-3, 4-9" value={ranges} disabled={mode !== "ranges"} onChange={(e) => setRanges(e.target.value)} />)}
      {choice("outline", "At bookmarks of level", <input type="number" min={1} aria-label="Bookmark level" value={level} disabled={mode !== "outline" || !hasBookmarks} onChange={(e) => setLevel(Math.max(1, Number(e.target.value) || 1))} />)}
      {!hasBookmarks && mode === "outline" && <p className="pli-dialog-note">This document has no bookmarks.</p>}
      {error ? (
        <p className="pli-dialog-error" role="alert">
          {error}
        </p>
      ) : (
        <div className="pli-dialog-note" aria-live="polite">
          {plan.length === 0 ? "Nothing to split yet." : `${plural(plan.length, "file")}: ${plan.map((r, i) => `${i + 1}. pages ${r}`).join("; ")}`}
        </div>
      )}
      {plan.length > 1 && (
        <label className="pli-radio-row">
          <input type="checkbox" checked={zip} onChange={(e) => setZip(e.target.checked)} /> Download as one ZIP file
        </label>
      )}
    </Dialog>
  );
}

const STYLES: { id: NumberingStyle | "none" | "custom"; label: string }[] = [
  { id: "decimal", label: "1, 2, 3" },
  { id: "roman", label: "i, ii, iii" },
  { id: "ROMAN", label: "I, II, III" },
  { id: "alpha", label: "a, b, c" },
  { id: "ALPHA", label: "A, B, C" },
  { id: "custom", label: "The same text on each page" },
  { id: "none", label: "No labels (use the page numbers)" },
];

function LabelsDialog({ tools }: { tools: PageTools }) {
  const selected = tools.selected();
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [style, setStyle] = useState<NumberingStyle | "none" | "custom">("decimal");
  const [start, setStart] = useState(1);
  const [prefix, setPrefix] = useState("");
  const [text, setText] = useState("");
  const ids = scope === "all" ? tools.pages.map((p) => p.id) : selected;
  const first = tools.pages.find((p) => p.id === ids[0]);
  const close = () => tools.closeDialog();
  return (
    <Dialog
      open
      title="Page labels"
      onClose={close}
      onSubmit={() => {
        tools.closeDialog();
        tools.applyLabels(ids, { style, start, prefix, text });
      }}
      actions={<Buttons close={close} label="Apply" disabled={tools.readOnly || (style === "custom" && text.trim() === "")} />}
    >
      <p className="pli-dialog-note">Labels are the page numbers a PDF reader shows, such as ii for a preface. They do not change the pages.</p>
      <label className="pli-field-row">
        <span>Apply to</span>
        <select aria-label="Apply to" value={scope} onChange={(e) => setScope(e.target.value as "selected" | "all")}>
          <option value="selected">{plural(selected.length, "selected page")}</option>
          <option value="all">All {tools.pages.length} pages</option>
        </select>
      </label>
      <label className="pli-field-row">
        <span>Numbering</span>
        <select aria-label="Numbering" value={style} onChange={(e) => setStyle(e.target.value as typeof style)}>
          {STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {style === "custom" ? (
        <label className="pli-field-row">
          <span>Label</span>
          <input type="text" aria-label="Label" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      ) : (
        style !== "none" && (
          <>
            <label className="pli-field-row">
              <span>Start at</span>
              <input type="number" min={1} aria-label="Start at" value={start} onChange={(e) => setStart(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
            </label>
            <label className="pli-field-row">
              <span>Prefix</span>
              <input type="text" aria-label="Prefix" placeholder="A-" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
            </label>
          </>
        )
      )}
      {first && <p className="pli-dialog-note">The first page is now labelled {first.label ?? tools.pages.indexOf(first) + 1}.</p>}
    </Dialog>
  );
}

function MoveDialog({ tools }: { tools: PageTools }) {
  const ids = tools.selected();
  const n = tools.pages.length;
  const [page, setPage] = useState(1);
  const close = () => tools.closeDialog();
  return (
    <Dialog
      open
      title={`Move ${plural(ids.length, "page")}`}
      onClose={close}
      onSubmit={() => {
        tools.closeDialog();
        tools.moveToPage(ids, page);
      }}
      actions={<Buttons close={close} label="Move" />}
    >
      <label className="pli-field-row">
        <span>Move before page</span>
        <input type="number" min={1} max={n + 1} aria-label="Move before page" autoFocus value={page} onChange={(e) => setPage(Math.max(1, Math.min(n + 1, Math.floor(Number(e.target.value) || 1))))} />
      </label>
      <p className="pli-dialog-note">Use {n + 1} to move to the end.</p>
    </Dialog>
  );
}

// ---- file dialogs -----------------------------------------------------------------------------------------------------

const CHOICES: { id: SaveChoice; label: string; note: string }[] = [
  { id: "keep", label: "Keep the original", note: "Adds your changes to the end of the file. Digital signatures stay valid. The file can be larger." },
  { id: "optimise", label: "Smaller file", note: "Writes a new file and leaves out what is not used. Breaks digital signatures." },
  { id: "flatten", label: "Flatten annotations and form fields", note: "Makes them part of the page, so nobody can change them. Writes a new file." },
  { id: "forms", label: "Flatten form fields only", note: "Fills in the form for good. Comments and markup stay editable." },
];

/** The dialogs of the file commands (download options, the result and its warnings, page pictures, unsaved changes). */
export function FileDialogs({ files }: { files: FileActions }) {
  useStore(files);
  const d = files.dialog;
  if (!d) return null;
  switch (d.type) {
    case "download":
      return <DownloadDialog files={files} />;
    case "result":
      return <ResultDialog files={files} d={d} />;
    case "export":
      return <ExportDialog files={files} />;
    case "discard":
      return (
        <Dialog
          open
          title="Discard your changes?"
          onClose={() => files.closeDialog()}
          onSubmit={() => {
            files.closeDialog();
            void d.then();
          }}
          actions={<Buttons close={() => files.closeDialog()} label="Discard and open" danger />}
        >
          <p className="pli-dialog-note">This document has changes that are not saved. Opening another file loses them.</p>
        </Dialog>
      );
  }
}

function DownloadDialog({ files }: { files: FileActions }) {
  const [choice, setChoice] = useState<SaveChoice>("keep");
  const [scrub, setScrub] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void files.preflight().then((list) => live && setNotes(list));
    return () => {
      live = false;
    };
  }, [files]);
  const close = () => files.closeDialog();
  return (
    <Dialog
      open
      title="Download"
      onClose={close}
      onSubmit={() => {
        files.closeDialog();
        void files.download(choice, { scrub });
      }}
      actions={<Buttons close={close} label="Download" />}
    >
      <fieldset className="pli-radio-row" aria-label="How to write the file">
        {CHOICES.map((c) => (
          <label key={c.id} className="pli-pdf-choice">
            <input type="radio" name="save-choice" checked={choice === c.id} onChange={() => setChoice(c.id)} />
            <span>
              <strong>{c.label}</strong>
              <span className="pli-dialog-note">{c.note}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="pli-radio-row">
        <input type="checkbox" checked={scrub} onChange={(e) => setScrub(e.target.checked)} /> Remove the author, title and other identifying data
      </label>
      <p className="pli-dialog-note">
        Original size: {formatSize(files.originalSize)}. {files.name}
      </p>
      {files.hasEdits() && (
        <p className="pli-dialog-note" role="note" data-edits>
          {EDITS_NOTE}
        </p>
      )}
      {notes.length > 0 && (
        <div role="group" aria-label="Before you download">
          <p>
            <strong>{plural(notes.length, "thing")} will not be written exactly</strong>
          </p>
          <ul className="pli-pdf-warnings">
            {notes.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

function ResultDialog({ files, d }: { files: FileActions; d: Extract<NonNullable<FileActions["dialog"]>, { type: "result" }> }) {
  const diff = d.original > 0 ? Math.round(((d.size - d.original) / d.original) * 100) : 0;
  return (
    <Dialog open title={d.title} onClose={() => files.closeDialog()} actions={<><span className="pli-spacer-flex" /><button type="submit" className="pli-button pli-button-primary">Close</button></>} onSubmit={() => files.closeDialog()}>
      <p>
        <strong>{d.name}</strong>
      </p>
      <p className="pli-dialog-note">
        {formatSize(d.size)}
        {d.original > 0 ? `, the original was ${formatSize(d.original)} (${diff === 0 ? "no change" : diff > 0 ? `${diff}% bigger` : `${-diff}% smaller`})` : ""}.{" "}
        {d.mode === "incremental" ? "Your changes were added to the end of the original file." : "A new file was written."}
      </p>
      {d.warnings.length > 0 && (
        <div role="group" aria-label="Warnings">
          <p>
            <strong>{plural(d.warnings.length, "thing")} could not be written exactly</strong>
          </p>
          <ul className="pli-pdf-warnings">
            {d.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

const DPIS = [72, 96, 150, 200, 300, 600];

function ExportDialog({ files }: { files: FileActions }) {
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [dpi, setDpi] = useState(150);
  const [pages, setPages] = useState<"selected" | "all" | "range">("selected");
  const [range, setRange] = useState("");
  const [zip, setZip] = useState(true);
  const selected = files.selectedPages().length;
  const total = files.session.doc.pages.length;
  const running = files.progress !== null;
  const request = pages === "range" ? range : pages;
  let count = 0;
  let error: string | null = null;
  try {
    count = pages === "range" && range.trim() === "" ? 0 : files.exportPositions(request).length;
  } catch (e) {
    error = messageOf(e);
  }
  const close = () => (running ? files.cancelExport() : files.closeDialog());
  return (
    <Dialog
      open
      title="Export pages as pictures"
      onClose={() => files.closeDialog()}
      onSubmit={() => {
        if (!running) void files.exportImages({ format, dpi, pages: request, zip });
      }}
      actions={
        <>
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button" onClick={close}>
            {running ? "Stop" : "Cancel"}
          </button>
          <button type="submit" className="pli-button pli-button-primary" disabled={running || count === 0 || error !== null}>
            {count > 1 ? `Export ${count} pages` : "Export"}
          </button>
        </>
      }
    >
      <fieldset className="pli-radio-row" disabled={running}>
        <legend>Format</legend>
        <label>
          <input type="radio" name="img-format" checked={format === "png"} onChange={() => setFormat("png")} /> PNG
        </label>
        <label>
          <input type="radio" name="img-format" checked={format === "jpeg"} onChange={() => setFormat("jpeg")} /> JPEG
        </label>
      </fieldset>
      <label className="pli-field-row">
        <span>Resolution</span>
        <select aria-label="Resolution" value={dpi} disabled={running} onChange={(e) => setDpi(Number(e.target.value))}>
          {DPIS.map((v) => (
            <option key={v} value={v}>
              {v} dpi
            </option>
          ))}
        </select>
      </label>
      <fieldset className="pli-radio-row" disabled={running}>
        <legend>Pages</legend>
        <label>
          <input type="radio" name="img-pages" checked={pages === "selected"} onChange={() => setPages("selected")} /> {selected === 1 ? "The page shown" : `The ${selected} selected pages`}
        </label>
        <label>
          <input type="radio" name="img-pages" checked={pages === "all"} onChange={() => setPages("all")} /> All {total} pages
        </label>
        <label>
          <input type="radio" name="img-pages" checked={pages === "range"} onChange={() => setPages("range")} /> These:
          <input type="text" aria-label="Page range" placeholder="1-3, 5" value={range} onFocus={() => setPages("range")} onChange={(e) => setRange(e.target.value)} />
        </label>
      </fieldset>
      {count > 1 && (
        <label className="pli-radio-row">
          <input type="checkbox" checked={zip} disabled={running} onChange={(e) => setZip(e.target.checked)} /> Download as one ZIP file
        </label>
      )}
      {error && (
        <p className="pli-dialog-error" role="alert">
          {error}
        </p>
      )}
      {files.progress && (
        <div aria-live="polite">
          <progress max={files.progress.total} value={files.progress.done} aria-label="Progress" /> <span className="pli-dialog-note">{files.progress.done} of {files.progress.total}</span>
        </div>
      )}
      <p className="pli-dialog-note">The pictures show the document as it would be saved, with annotations.</p>
    </Dialog>
  );
}
