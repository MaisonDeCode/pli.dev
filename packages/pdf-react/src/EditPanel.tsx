import { useContext, useRef, type ReactNode } from "react";
import { FilePickerContext, keepFocus, pickWith } from "@pli.dev/react";
import { EDIT_KEY, styleOfEdit, type EditController } from "./editController";
import { EditIcons as I } from "./editIcons";
import type { PdfViewContext } from "./extensions";
import { useSessionRevision } from "./hooks";
import { useStore } from "./store";

/** The panel of the Edit tool (font, size, colour, picture) and the Edits tab (what is waiting for the save). */

function Field({ label, children, inline }: { label: string; children: ReactNode; inline?: boolean }) {
  return (
    <div className={inline ? "pli-pdf-field pli-pdf-field-inline" : "pli-pdf-field"}>
      <span className="pli-pdf-field-label">{label}</span>
      {children}
    </div>
  );
}

function Warnings({ list }: { list: readonly string[] }) {
  if (list.length === 0) return null;
  return (
    <ul className="pli-edit-warnings" role="note" aria-label="Warnings">
      {list.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  );
}

/** What can be changed about the selected text or picture. Shown on the right while the Edit tool is on. */
export function EditPanel({ c, view }: { c: EditController; view: PdfViewContext }) {
  c.setView(view);
  useStore(c);
  useSessionRevision(c.session);
  const fileInput = useRef<HTMLInputElement>(null);
  const picker = useContext(FilePickerContext);
  const sel = c.selected;
  const run = sel?.kind === "run" ? c.run(sel.page, sel.id) : undefined;
  const image = sel?.kind === "image" ? c.image(sel.page, sel.id) : undefined;

  if (image && sel) {
    const edit = c.imageEdit(sel.page, image.id);
    return (
      <section className="pli-edit-props" aria-label="Edit picture">
        <h2 className="pli-pdf-props-title">Picture</h2>
        <p className="pli-pdf-meta">
          {image.width} × {image.height} pixels
          {edit ? (edit.picture ? " · will be replaced" : " · will be removed") : ""}
        </p>
        <div className="pli-pdf-actions" role="group" aria-label="Picture actions">
          <button
            type="button"
            className="pli-button"
            onClick={() => {
              if (!picker) return fileInput.current?.click();
              void pickWith(picker, { purpose: "image", accept: "image/png,image/jpeg", label: "Choose a picture to replace this one" }).then(([file]) => (file ? c.replacePicture(file) : undefined));
            }}
          >
            {I.picture} Replace picture…
          </button>
          {!picker && (
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg"
              aria-label="Choose a picture"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void c.replacePicture(file);
              }}
            />
          )}
          <button type="button" className="pli-button pli-button-danger" disabled={edit?.picture === null} onClick={() => void c.deletePicture()}>
            {I.trash} Delete picture
          </button>
          {edit && (
            <button type="button" className="pli-button" onClick={() => c.remove(edit.id)}>
              Keep the original
            </button>
          )}
        </div>
        <Field label="New picture fits">
          <div role="radiogroup" aria-label="Fit" className="pli-edit-fit">
            {(["contain", "stretch"] as const).map((fit) => (
              <label key={fit} className="pli-pdf-check">
                <input type="radio" name="pli-edit-fit" aria-label={fit === "contain" ? "Keep proportions" : "Stretch to fill"} checked={(edit?.fit ?? c.fit) === fit} onChange={() => void c.setFit(fit)} />{" "}
                {fit === "contain" ? "Keep proportions" : "Stretch to fill"}
              </label>
            ))}
          </div>
        </Field>
      </section>
    );
  }

  if (run && sel) {
    if (!run.editable)
      return (
        <section className="pli-edit-props" aria-label="Edit text">
          <h2 className="pli-pdf-props-title">Text</h2>
          <p className="pli-edit-reason">{run.reason ?? "This text cannot be edited."}</p>
        </section>
      );
    const pending = c.textEdit(sel.page, run.id);
    const editing = c.editing?.run.id === run.id ? c.editing : null;
    const style = editing ? editing.style : styleOfEdit(pending);
    const looks = c.looks(run, style);
    const warnings = editing ? c.editingWarnings : c.pending().find((p) => p.id === pending?.id)?.warnings ?? [];
    const set = (patch: Parameters<EditController["setStyle"]>[0]) => void c.setStyle(patch);
    return (
      <section className="pli-edit-props" aria-label="Edit text">
        <h2 className="pli-pdf-props-title">Text</h2>
        <p className="pli-pdf-meta">
          {run.font.name}
          {run.kind === "composite" ? " · a font with many letters" : ""}
          {pending ? " · changed" : ""}
        </p>
        <p className="pli-pdf-meta">Font, size, style and colour are in the text bar above the pages.</p>
        <Field label="If it is too wide" inline>
          <label className="pli-pdf-check">
            <input type="checkbox" aria-label="Shrink to fit" checked={looks.fit === "shrink"} onChange={(e) => set({ fit: e.target.checked ? "shrink" : "none" })} /> Shrink to fit
          </label>
        </Field>
        <Warnings list={warnings} />
        {pending && (
          <div className="pli-pdf-actions" role="group" aria-label="Actions">
            <button type="button" className="pli-button" onClick={() => c.remove(pending.id)}>
              Keep the original text
            </button>
          </div>
        )}
      </section>
    );
  }

  const count = c.pending().length;
  return (
    <section className="pli-edit-props" aria-label="Edit text and pictures">
      <h2 className="pli-pdf-props-title">Edit text and pictures</h2>
      <p className="pli-pdf-meta">Click text to retype it, or a picture to replace or delete it. Press Esc to stop.</p>
      {count > 0 && <p className="pli-pdf-meta">{count === 1 ? "1 change is waiting for the save." : `${count} changes are waiting for the save.`}</p>}
    </section>
  );
}

/** The sidebar tab that lists the changes waiting for the save. */
export function EditsTab({ c, view }: { c: EditController; view: PdfViewContext }) {
  c.setView(view);
  useStore(c);
  useSessionRevision(c.session);
  const list = c.pending();
  const readOnly = c.readOnly;
  return (
    <div className="pli-edit-list" role="region" aria-label="Edits">
      {list.length === 0 ? (
        <p className="pli-pdf-empty">
          No edits yet. Choose the Edit tool ({EDIT_KEY}) and click text or a picture.
        </p>
      ) : (
        <>
          <ul className="pli-edit-items">
            {list.map((p) => (
              <li key={p.id} className="pli-edit-item" data-edit={p.id} data-kind={p.kind}>
                <div className="pli-edit-row">
                  <button type="button" className="pli-edit-go" title="Show on the page" onClick={() => c.reveal(p.id)}>
                    <span className="pli-edit-page">Page {p.pageNumber}</span>
                    <span className="pli-edit-label">{p.label}</span>
                  </button>
                  {!readOnly && (
                    <button type="button" className="pli-tool pli-pdf-tool" aria-label={`Remove edit: ${p.label}`} title="Keep the original" onMouseDown={keepFocus} onClick={() => c.remove(p.id)}>
                      {I.trash}
                    </button>
                  )}
                </div>
                <Warnings list={p.warnings} />
              </li>
            ))}
          </ul>
          <div className="pli-edit-foot">
            <p className="pli-pdf-meta">A file with edits is saved as a new file: the page contents are rewritten, so the old text and pictures are really gone.</p>
            {!readOnly && (
              <button type="button" className="pli-button" onClick={() => c.removeAll()}>
                Remove all edits
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
