import { useState, useSyncExternalStore } from "react";
import { Composer, ThreadCard, keepFocus } from "@pli.dev/react";
import type { Annotation, LinkAnnot } from "@pli.dev/pdf";
import { AnnotIcons as I } from "./annotIcons";
import { selectionBox, unionRects } from "./annotGeometry";
import { describeType, type AnnotController } from "./annotController";
import { colorOf, supports, withColor } from "./annotProps";
import { SWATCHES } from "./annotStyles";
import { Popover, Portal, useAnchor, useController } from "./annotUi";

/** Floating panels: the comment of an annotation, a new note, a link, the bar over selected text and the bar over a selected annotation. */

const noop = () => {};

/** `https://` is added to an address without a scheme; script-like addresses are refused. Returns null when it is not usable. */
export function cleanUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? `mailto:${text}` : `https://${text}`;
  if (/^(javascript|data|vbscript|file):/i.test(withScheme)) return null;
  return withScheme;
}

function CommentBody({ c, annot }: { c: AnnotController; annot: Annotation }) {
  const client = c.client;
  const subscribe = (listener: () => void) => (client ? client.subscribe(listener) : noop);
  useSyncExternalStore(subscribe, () => client?.threads, () => client?.threads);
  const thread = annot.thread && client ? client.thread(annot.thread) : undefined;
  if (thread && client) {
    return (
      <ul className="pli-thread-list">
        <ThreadCard client={client} thread={thread} active onActivate={() => c.reveal(annot.id)} quoteLabel="Go to the annotation" fallbackQuote={describeType(annot.type)} />
      </ul>
    );
  }
  if ((client && !client.can("comment")) || c.readOnly) {
    return <p className="pli-comments-note">{annot.contents || "No comment."}</p>;
  }
  return (
    <Composer
      autoFocus
      users={c.users}
      initial={client ? "" : (annot.contents ?? "")}
      placeholder={client ? "Add a comment" : "Comment"}
      submit={client ? "Comment" : "Save"}
      onCancel={() => c.closePopover()}
      onSubmit={(body, mentions) => {
        c.comment(annot.id, body, mentions);
        if (!client) c.closePopover();
      }}
    />
  );
}

/** The comment of an annotation, or the box that starts a new note. */
export function CommentPopover({ c }: { c: AnnotController }) {
  const p = c.popover;
  const annot = p?.kind === "comment" ? c.session.annots.get(p.annot) : undefined;
  const page = p?.kind === "comment" ? c.pageOf(p.annot) : p?.kind === "new-note" ? p.page : null;
  const rect = annot ? selectionBox(annot) : p?.kind === "new-note" ? { x: p.x, y: p.y, w: 24, h: 24 } : null;
  const anchor = useAnchor(c, page ?? null, rect);
  if (!p || (p.kind !== "comment" && p.kind !== "new-note")) return null;
  if (p.kind === "comment" && !annot) return null;
  return (
    <Portal c={c}>
      <Popover anchor={anchor} label={p.kind === "new-note" ? "New note" : `${describeType(annot!.type)} comment`} onClose={() => c.closePopover()} className="pli-pdf-comment-popover">
        {p.kind === "new-note" ? (
          <Composer
            autoFocus
            users={c.users}
            placeholder="Write a comment"
            submit="Add note"
            onCancel={() => c.closePopover()}
            onSubmit={(body, mentions) => {
              c.addNote(p.page, p.x, p.y, body, mentions);
              c.draft = null;
              c.closePopover();
              c.finishTool("note");
            }}
          />
        ) : (
          <CommentBody c={c} annot={annot!} />
        )}
      </Popover>
    </Portal>
  );
}

/** Where a new or existing link goes: a web address or a page of this document. */
export function LinkPopover({ c }: { c: AnnotController }) {
  const p = c.popover?.kind === "link" ? c.popover : null;
  const existing = p?.annot ? (c.session.annots.get(p.annot) as LinkAnnot | undefined) : undefined;
  const [kind, setKind] = useState<"uri" | "page">(existing?.dest ? "page" : "uri");
  const [url, setUrl] = useState(existing?.uri ?? "");
  const [pageId, setPageId] = useState(existing?.dest?.page ?? c.session.doc.pages[0]?.id ?? "");
  const [error, setError] = useState("");
  const anchor = useAnchor(c, p?.page ?? null, p?.rect ?? null);
  if (!p) return null;
  const close = () => {
    c.draft = null;
    c.closePopover();
  };
  const save = () => {
    const target = kind === "uri" ? cleanUrl(url) : pageId;
    if (!target) return setError(kind === "uri" ? "Enter a web address, such as example.com" : "Choose a page");
    const data = kind === "uri" ? { uri: target, dest: undefined } : { dest: { page: pageId }, uri: undefined };
    if (existing) c.patch([existing.id], () => data as Partial<Annotation>);
    else c.add(p.page, { type: "link", rect: p.rect, ...(kind === "uri" ? { uri: target } : { dest: { page: pageId } }) } as never);
    close();
    if (!existing) c.setTool("select");
  };
  return (
    <Portal c={c}>
      <Popover anchor={anchor} label="Link" onClose={close} className="pli-pdf-link-popover">
        <form
          className="pli-pdf-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <fieldset>
            <legend>Link to</legend>
            <label>
              <input type="radio" name="link-kind" checked={kind === "uri"} onChange={() => setKind("uri")} /> A web address
            </label>
            <label>
              <input type="radio" name="link-kind" checked={kind === "page"} onChange={() => setKind("page")} /> A page in this document
            </label>
          </fieldset>
          {kind === "uri" ? (
            <label>
              Address
              <input type="text" aria-label="Web address" value={url} placeholder="example.com" autoFocus onChange={(e) => (setUrl(e.target.value), setError(""))} />
            </label>
          ) : (
            <label>
              Page
              <select aria-label="Page" value={pageId} onChange={(e) => setPageId(e.target.value)}>
                {c.session.doc.pages.map((pg, i) => (
                  <option key={pg.id} value={pg.id}>
                    Page {i + 1}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && (
            <p className="pli-dialog-error" role="alert">
              {error}
            </p>
          )}
          <div className="pli-composer-actions">
            <button type="button" className="pli-button" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="pli-button pli-button-primary">
              {existing ? "Save" : "Add link"}
            </button>
          </div>
        </form>
      </Popover>
    </Portal>
  );
}

/** The bar over selected text (when no markup tool is active): highlight colours, underline, strikethrough, comment, copy. */
export function SelectionBar({ c }: { c: AnnotController }) {
  const sel = c.textSelection;
  // Anchored to the page rectangles of the selection (not to the screen place measured when the mouse went up), so a zoom or a resize carries the bar along.
  const first = sel?.selected[0];
  const anchor = useAnchor(c, first?.page ?? null, first ? unionRects(first.rects) : null);
  if (!sel || c.options.selectionBar === false || c.readOnly) return null;
  const close = () => {
    c.textSelection = null;
    c.emit();
  };
  const text = sel.selected.map((s) => s.text).join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      document.execCommand?.("copy");
    }
    c.announce("Copied");
    close();
  };
  const button = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <button type="button" className="pli-tool pli-pdf-tool" aria-label={label} title={label} onMouseDown={keepFocus} onClick={onClick}>
      {icon}
    </button>
  );
  return (
    <Portal c={c}>
      <Popover anchor={anchor} label="Text selection" role="toolbar" onClose={close} className="pli-pdf-selbar">
        <div className="pli-pdf-swatches" role="group" aria-label="Highlight colour">
          {SWATCHES.slice(0, 4).map((color) => (
            <button key={color} type="button" className="pli-swatch" style={{ background: color }} aria-label={`Highlight ${color}`} title="Highlight" onMouseDown={keepFocus} onClick={() => (c.markup("highlight", sel.selected, { color }), c.emit())} />
          ))}
        </div>
        {button("Underline", I.underline, () => c.markup("underline", sel.selected))}
        {button("Strikethrough", I.strikeout, () => c.markup("strikeout", sel.selected))}
        {button("Squiggly underline", I.squiggly, () => c.markup("squiggly", sel.selected))}
        {button("Highlight and comment", I.comment, () => {
          const ids = c.markup("highlight", sel.selected);
          if (ids[0]) c.openComment(ids[0]);
        })}
        {c.tools.has("redact") && button("Mark for redaction", I.redact, () => c.markRedaction(sel.selected))}
        {button("Copy", I.copy, () => void copy())}
      </Popover>
    </Portal>
  );
}

/** A small bar over a selected annotation: colours, comment, duplicate, delete. */
export function CompactBar({ c }: { c: AnnotController }) {
  useController(c);
  const [only] = c.selected;
  const show = c.options.popover !== false && !c.readOnly && c.selected.length === 1 && !!only && !c.editing && !c.popover && c.preview.size === 0 && !c.draft && (c.toolId === "select" || c.toolId === null);
  const pageId = only ? c.pageOf(only.id) : null;
  const anchor = useAnchor(c, show && pageId ? pageId : null, show && only ? selectionBox(only) : null);
  if (!show || !only || !anchor) return null;
  const sup = supports(only);
  const color = colorOf(only);
  return (
    <Portal c={c}>
      <Popover anchor={anchor} label={`${describeType(only.type)} actions`} role="toolbar" onClose={noop} className="pli-pdf-compact" above>
        {sup.color && (
          <div className="pli-pdf-swatches" role="group" aria-label="Colour">
            {SWATCHES.slice(0, 6).map((sw) => (
              <button key={sw} type="button" className="pli-swatch" style={{ background: sw }} aria-label={sw} aria-pressed={color?.toLowerCase() === sw} onMouseDown={keepFocus} onClick={() => c.patch([only.id], (a) => withColor(a, sw))} />
            ))}
          </div>
        )}
        <button type="button" className="pli-tool pli-pdf-tool" aria-label="Add comment" title="Add comment" onMouseDown={keepFocus} onClick={() => c.openComment(only.id)}>
          {I.comment}
        </button>
        <button type="button" className="pli-tool pli-pdf-tool" aria-label="Duplicate" title="Duplicate" onMouseDown={keepFocus} onClick={() => c.duplicate()}>
          {I.copy}
        </button>
        <button type="button" className="pli-tool pli-pdf-tool" aria-label="Delete" title="Delete" disabled={!!only.locked} onMouseDown={keepFocus} onClick={() => c.deleteSelected()}>
          {I.trash}
        </button>
      </Popover>
    </Portal>
  );
}
