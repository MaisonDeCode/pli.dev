import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { MAIN_SOURCE, PdfFile, isString, textOf, type PdfSession } from "@pli.dev/pdf";
import { formatSize } from "./PdfDialogs";
import { shortcutGroups } from "./shortcuts";
import { documentName } from "./download";
import { useSessionRevision } from "./hooks";

/** The keyboard help: every group the editor (and your own tools) registered with `registerShortcuts`, as written in the code. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Read when it opens, so the groups of tools that registered later are in it.
  const groups = useMemo(() => (open ? shortcutGroups() : []), [open]);
  return (
    <Dialog open={open} title="Keyboard shortcuts" onClose={onClose} onSubmit={onClose} actions={<><span className="pli-spacer-flex" /><button type="submit" className="pli-button pli-button-primary">Close</button></>}>
      <div className="pli-pdf-shortcuts" role="document">
        {groups.map(({ group, rows }) => (
          <section key={group} className="pli-pdf-shortcut-group" aria-label={group}>
            <h3>{group}</h3>
            <table>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <th scope="row">{row.keys}</th>
                    <td>{row.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

const MM = 25.4 / 72;
const PAPER: [string, number, number][] = [
  ["Letter", 612, 792],
  ["Legal", 612, 1008],
  ["A3", 841.9, 1190.6],
  ["A4", 595.3, 841.9],
  ["A5", 419.5, 595.3],
];

/** "8.5 × 11 in (Letter)". */
export function describeSize(w: number, h: number): string {
  const [a, b] = w <= h ? [w, h] : [h, w];
  const paper = PAPER.find(([, pw, ph]) => Math.abs(pw - a) < 3 && Math.abs(ph - b) < 3)?.[0];
  const inch = (n: number) => String(Math.round((n / 72) * 100) / 100);
  return `${inch(w)} × ${inch(h)} in (${Math.round(w * MM)} × ${Math.round(h * MM)} mm)${paper ? `, ${paper}${w > h ? " landscape" : ""}` : ""}`;
}

interface FileFacts {
  version: string;
  encrypted: boolean;
  producer?: string;
  created?: string;
}

/** What the file itself says: version, encryption, who made it. Read from the original bytes, not from the changes. */
async function readFacts(session: PdfSession): Promise<FileFacts | null> {
  const source = session.doc.sources.find((s) => s.id === MAIN_SOURCE);
  if (!source) return null;
  const bytes = await session.sources.get(source);
  if (!bytes) return null;
  const file = PdfFile.open(bytes, { password: session.options.password });
  const info = file.info();
  const text = (key: string): string | undefined => {
    const v = info ? file.dictGet(info, key) : null;
    return isString(v) ? textOf(v) || undefined : undefined;
  };
  const date = text("CreationDate");
  const m = date ? /^D:(\d{4})(\d{2})?(\d{2})?/.exec(date) : null;
  return { version: file.version, encrypted: file.encrypted, producer: text("Producer"), created: m ? [m[1], m[2], m[3]].filter(Boolean).join("-") : undefined };
}

/** Title, author, subject and keywords (written into the file by the next save, as one step of undo), and what the file is. */
export function PropertiesDialog({ session, readOnly, open, onClose }: { session: PdfSession; readOnly: boolean; open: boolean; onClose: () => void }) {
  useSessionRevision(session);
  const doc = session.doc;
  const [draft, setDraft] = useState({ title: "", author: "", subject: "", keywords: "" });
  const [facts, setFacts] = useState<FileFacts | null>(null);
  useEffect(() => {
    if (!open) return;
    setDraft({ title: doc.meta.title ?? "", author: doc.meta.author ?? "", subject: doc.meta.subject ?? "", keywords: doc.meta.keywords ?? "" });
    let live = true;
    readFacts(session).then(
      (f) => live && setFacts(f),
      () => live && setFacts(null),
    );
    return () => {
      live = false;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = doc.pages[0];
  const main = doc.sources.find((s) => s.id === MAIN_SOURCE);
  const sizes = new Set(doc.pages.map((p) => `${Math.round(p.width)}x${Math.round(p.height)}`));
  const apply = () => {
    const patch: Record<string, string | null> = {};
    for (const key of ["title", "author", "subject", "keywords"] as const) {
      const was = doc.meta[key] ?? "";
      if (draft[key].trim() !== was) patch[key] = draft[key].trim() || null;
    }
    if (Object.keys(patch).length) session.transact([{ type: "set_meta", patch }]);
    onClose();
  };
  const field = (key: keyof typeof draft, label: string) => (
    <label className="pli-field-row">
      <span>{label}</span>
      <input type="text" aria-label={label} value={draft[key]} readOnly={readOnly} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} />
    </label>
  );
  return (
    <Dialog
      open={open}
      title="Document properties"
      onClose={onClose}
      onSubmit={readOnly ? onClose : apply}
      actions={
        <>
          <span className="pli-spacer-flex" />
          {!readOnly && (
            <button type="button" className="pli-button" onClick={onClose}>
              Cancel
            </button>
          )}
          <button type="submit" className="pli-button pli-button-primary">
            {readOnly ? "Close" : "Save"}
          </button>
        </>
      }
    >
      <div className="pli-pdf-properties-dialog">
        {field("title", "Title")}
        {field("author", "Author")}
        {field("subject", "Subject")}
        {field("keywords", "Keywords")}
        <dl className="pli-pdf-facts" aria-label="About the file">
          <dt>File name</dt>
          <dd>{documentName(doc)}</dd>
          <dt>Pages</dt>
          <dd>{doc.pages.length}</dd>
          <dt>Page size</dt>
          <dd>{first ? `${describeSize(first.width, first.height)}${sizes.size > 1 ? " (and other sizes)" : ""}` : "No pages"}</dd>
          {main && (
            <>
              <dt>File size</dt>
              <dd>{formatSize(main.size)}</dd>
            </>
          )}
          {facts && (
            <>
              <dt>PDF version</dt>
              <dd>{facts.version}</dd>
              <dt>Protected with a password</dt>
              <dd>{facts.encrypted ? "Yes" : "No"}</dd>
              {facts.producer && (
                <>
                  <dt>Made with</dt>
                  <dd>{facts.producer}</dd>
                </>
              )}
              {facts.created && (
                <>
                  <dt>Created</dt>
                  <dd>{facts.created}</dd>
                </>
              )}
            </>
          )}
        </dl>
      </div>
    </Dialog>
  );
}

/** Counts of the words, characters and pages, from the text of every page (read when the dialog opens). */
export function WordCountDialog({ session, open, onClose }: { session: PdfSession; open: boolean; onClose: () => void }) {
  const [counts, setCounts] = useState<{ words: number; characters: number; pages: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    setCounts(null);
    let live = true;
    (async () => {
      let words = 0;
      let characters = 0;
      const pages = session.doc.pages;
      for (const page of pages) {
        if (!page.from) continue;
        const text = (await session.content.text(page.id)).lines.map((l) => l.text).join("\n");
        words += text.split(/\s+/).filter(Boolean).length;
        characters += text.replace(/\s/g, "").length;
      }
      if (live) setCounts({ words, characters, pages: pages.length });
    })().catch(() => live && setCounts({ words: 0, characters: 0, pages: session.doc.pages.length }));
    return () => {
      live = false;
    };
  }, [open, session]);
  return (
    <Dialog open={open} title="Word count" onClose={onClose} onSubmit={onClose} actions={<><span className="pli-spacer-flex" /><button type="submit" className="pli-button pli-button-primary">Close</button></>}>
      {counts ? (
        <dl className="pli-pdf-facts" aria-label="Counts">
          <dt>Pages</dt>
          <dd>{counts.pages}</dd>
          <dt>Words</dt>
          <dd>{counts.words}</dd>
          <dt>Characters (no spaces)</dt>
          <dd>{counts.characters}</dd>
        </dl>
      ) : (
        <p className="pli-dialog-note" role="status">
          Counting…
        </p>
      )}
    </Dialog>
  );
}
