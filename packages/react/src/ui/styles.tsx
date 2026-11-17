import { useState } from "react";
import { styleList, type DocStyle, type DocumentSession } from "@pli.dev/docs";
import { Dialog } from "./primitives";

export interface NewStyleDialogProps {
  open: boolean;
  kind: DocStyle["kind"];
  onCreate: (name: string) => void;
  onClose: () => void;
}

/** Asks for the name of a style that is about to be made from the selection. */
export function NewStyleDialog({ open, kind, onCreate, onClose }: NewStyleDialogProps) {
  const [name, setName] = useState("");
  const create = () => {
    if (!name.trim()) return;
    onCreate(name.trim());
    setName("");
    onClose();
  };
  return (
    <Dialog
      open={open}
      title={kind === "paragraph" ? "New paragraph style" : "New character style"}
      onClose={onClose}
      onSubmit={create}
      actions={
        <>
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="pli-button pli-button-primary" disabled={!name.trim()}>
            Create
          </button>
        </>
      }
    >
      <label className="pli-field-row">
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Note, Warning, Emphasis…" autoFocus />
      </label>
      <p className="pli-dialog-note">
        {kind === "paragraph"
          ? "The style takes the first selected paragraph's alignment, spacing and the formatting its text has throughout, and is applied to the selection."
          : "The style takes the formatting the selected text has throughout, and is applied to it."}
      </p>
    </Dialog>
  );
}

/** The loop a style would make if it were based on `base`: true when `base` is, or is based on, `id`. */
function leadsBack(styles: Readonly<Record<string, DocStyle>>, id: string, base: string): boolean {
  for (let at: string | undefined = base, steps = 0; at !== undefined && steps < 32; at = styles[at]?.basedOn, steps++) if (at === id) return true;
  return false;
}

/** A short description of what a style sets, for the list. */
function describe(style: DocStyle): string {
  const parts: string[] = [];
  const m = style.marks ?? {};
  if (m.fontFamily) parts.push(m.fontFamily);
  if (m.fontSize) parts.push(`${m.fontSize} pt`);
  if (m.bold) parts.push("bold");
  if (m.italic) parts.push("italic");
  if (m.underline) parts.push("underline");
  if (m.strike) parts.push("strikethrough");
  if (m.color) parts.push(`text ${m.color}`);
  if (m.highlight) parts.push(`highlight ${m.highlight}`);
  if (style.align) parts.push(style.align);
  if (style.format?.lineHeight) parts.push(`line ${style.format.lineHeight}`);
  if (style.format?.spaceBefore) parts.push(`${style.format.spaceBefore} pt before`);
  if (style.format?.spaceAfter) parts.push(`${style.format.spaceAfter} pt after`);
  if (style.format?.indentLeft) parts.push(`indent ${style.format.indentLeft} pt`);
  return parts.length > 0 ? parts.join(", ") : "No settings";
}

export interface ManageStylesDialogProps {
  open: boolean;
  session: DocumentSession;
  /** Bumps when the styles change, so the list is drawn again. */
  styles: Readonly<Record<string, DocStyle>>;
  onClose: () => void;
}

/** The document's styles: rename them, choose what each is based on, and delete them. */
export function ManageStylesDialog({ open, session, styles, onClose }: ManageStylesDialogProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const groups = [
    { kind: "paragraph" as const, title: "Paragraph styles" },
    { kind: "character" as const, title: "Character styles" },
  ];
  const any = Object.keys(styles).length > 0;
  return (
    <Dialog
      open={open}
      title="Styles"
      onClose={() => {
        setConfirming(null);
        onClose();
      }}
      actions={
        <>
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button pli-button-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {!any && <p className="pli-dialog-note">This document has no styles yet. Format some text, then choose Format &gt; Styles &gt; New paragraph style from selection.</p>}
      {groups.map(({ kind, title }) => {
        const list = styleList({ styles }, kind);
        if (list.length === 0) return null;
        return (
          <section key={kind} className="pli-style-group" aria-label={title}>
            <h3>{title}</h3>
            <ul>
              {list.map(({ id, style }) => (
                <li key={id} className="pli-style-row">
                  <input
                    type="text"
                    aria-label={`Name of ${style.name}`}
                    defaultValue={style.name}
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== style.name && session.changeStyle(id, { name: e.target.value.trim() })}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
                  />
                  <select
                    aria-label={`${style.name} is based on`}
                    value={style.basedOn ?? ""}
                    onChange={(e) => {
                      const { basedOn: _gone, ...rest } = style;
                      session.setStyle(id, e.target.value ? { ...rest, basedOn: e.target.value } : rest);
                    }}
                  >
                    <option value="">Not based on a style</option>
                    {styleList({ styles }, kind)
                      .filter((o) => o.id !== id && !leadsBack(styles, id, o.id))
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          Based on {o.style.name}
                        </option>
                      ))}
                  </select>
                  <span className="pli-style-look">{describe(style)}</span>
                  {confirming === id ? (
                    <span className="pli-style-confirm" role="alert">
                      Delete and take it off the text?{" "}
                      <button type="button" className="pli-link-button pli-danger" onClick={() => { session.deleteStyle(id); setConfirming(null); }}>
                        Delete
                      </button>{" "}
                      <button type="button" className="pli-link-button" onClick={() => setConfirming(null)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="pli-link-button pli-danger" onClick={() => setConfirming(id)}>
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </Dialog>
  );
}
