import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { keepFocus } from "@pli.dev/react";
import type { OutlineItem, PdfDoc } from "@pli.dev/pdf";
import type { RenderedOutlineItem } from "./renderer";
import { PdfIcons as I } from "./icons";
import { PageIcons as P } from "./pageIcons";
import type { OutlineEdit } from "./outlineEdit";

/** An outline entry as the sidebar shows it: where it goes is a position in the document. */
export interface OutlineNode {
  id: string;
  title: string;
  /** Position (0-based) of the page it goes to, and how far down it (page space). */
  page?: number;
  y?: number;
  uri?: string;
  open?: boolean;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  children: OutlineNode[];
}

/** The document's outline, with destinations turned from page ids into positions. */
export function outlineFromDoc(doc: Pick<PdfDoc, "outline" | "pages">): OutlineNode[] {
  const at = new Map(doc.pages.map((p, i) => [p.id, i] as const));
  const walk = (items: readonly OutlineItem[]): OutlineNode[] =>
    items.map((it) => ({
      id: it.id,
      title: it.title,
      page: it.dest ? at.get(it.dest.page) : undefined,
      y: it.dest?.y,
      uri: it.uri,
      open: it.open,
      bold: it.bold,
      italic: it.italic,
      color: it.color,
      children: walk(it.children),
    }));
  return walk(doc.outline);
}

/** An outline read by the renderer from a file the engine has not read. */
export function outlineFromRendered(items: readonly RenderedOutlineItem[], path = "r"): OutlineNode[] {
  return items.map((it, i) => ({ id: `${path}.${i}`, title: it.title, page: it.page, y: it.y, uri: it.uri, bold: it.bold, italic: it.italic, open: false, children: outlineFromRendered(it.children, `${path}.${i}`) }));
}

export interface OutlineProps {
  items: readonly OutlineNode[];
  /** Called when an entry that goes to a page is chosen. */
  onGo: (page: number, y?: number) => void;
  /** Called for an entry that goes to a web address (default: opens it in a new tab). */
  onLink?: (uri: string) => void;
  className?: string;
  /** Editing commands: with them bookmarks can be added, renamed, deleted, moved, indented and sent to the page shown. Leave out for a read-only outline. */
  edit?: OutlineEdit;
}

interface Flat {
  node: OutlineNode;
  level: number;
  parent: string | null;
  /** Position among its siblings. */
  index: number;
}

/** Where a drop on a row goes: before it, after it, or inside it as its last child. */
type Drop = { id: string; where: "before" | "after" | "into" };

const hasInside = (node: OutlineNode, id: string): boolean => node.id === id || node.children.some((c) => hasInside(c, id));

/** The outline as a tree you can fold and walk with the keyboard; choosing an entry takes the viewer to its page. */
export function Outline({ items, onGo, onLink, className, edit }: OutlineProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<string | null>(null);
  const expanded = (n: OutlineNode) => open[n.id] ?? n.open === true;

  const flat = useMemo(() => {
    const out: Flat[] = [];
    const walk = (list: readonly OutlineNode[], level: number, parent: string | null) => {
      for (const [index, node] of list.entries()) {
        out.push({ node, level, parent, index });
        if (node.children.length && (open[node.id] ?? node.open === true)) walk(node.children, level + 1, node.id);
      }
    };
    walk(items, 1, null);
    return out;
  }, [items, open]);

  // After a command the focus goes back to the bookmark it worked on.
  useEffect(() => {
    const id = focusAfter.current;
    if (!id || renaming) return;
    focusAfter.current = null;
    [...(root.current?.querySelectorAll<HTMLElement>("[data-id]") ?? [])].find((el) => el.dataset.id === id)?.focus();
  });

  const toolbar = edit && (
    <div className="pli-pdf-outline-tools" role="toolbar" aria-label="Bookmark tools">
      <button
        type="button"
        className="pli-button pli-pdf-outline-add"
        onMouseDown={keepFocus}
        onClick={() => {
          const id = edit.add(focus);
          if (id) {
            const site = flat.find((f) => f.node.id === focus);
            if (site?.parent) setOpen((o) => ({ ...o, [site.parent!]: true }));
            setFocus(id);
            setRenaming(id);
          }
        }}
      >
        {P.bookmarkAdd} Add bookmark here
      </button>
    </div>
  );

  if (items.length === 0)
    return (
      <>
        {toolbar}
        <p className="pli-pdf-empty">{edit ? "No bookmarks yet. Go to a page and add one." : "No outline"}</p>
      </>
    );

  const activate = (n: OutlineNode) => {
    setFocus(n.id);
    if (n.page !== undefined) onGo(n.page, n.y);
    else if (n.uri) (onLink ?? ((u) => window.open(u, "_blank", "noopener,noreferrer")))(n.uri);
  };
  const move = (id: string) => {
    setFocus(id);
    [...(root.current?.querySelectorAll<HTMLElement>("[data-id]") ?? [])].find((el) => el.dataset.id === id)?.focus();
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    const at = flat.findIndex((f) => f.node.id === (focus ?? flat[0]?.node.id));
    const cur = flat[at];
    if (!cur) return;
    const key = e.key;
    if (edit) {
      const id = cur.node.id;
      if (key === "F2") return (e.preventDefault(), e.stopPropagation(), setRenaming(id));
      if (key === "Delete") {
        e.preventDefault();
        e.stopPropagation();
        const neighbour = flat[at + 1]?.node.id ?? flat[at - 1]?.node.id;
        edit.remove(id);
        if (neighbour) move(neighbour);
        return;
      }
      if (e.altKey && e.shiftKey && (key === "ArrowRight" || key === "ArrowLeft")) {
        e.preventDefault();
        e.stopPropagation();
        focusAfter.current = id;
        if (key === "ArrowRight") edit.indent(id);
        else edit.outdent(id);
        return;
      }
      if (e.altKey && (key === "ArrowUp" || key === "ArrowDown")) {
        e.preventDefault();
        e.stopPropagation();
        const to = cur.index + (key === "ArrowUp" ? -1 : 1);
        const count = siblingsOf(cur).length;
        if (to >= 0 && to < count) {
          focusAfter.current = id;
          edit.move(id, cur.parent, to);
        }
        return;
      }
    }
    if (key === "ArrowDown") move(flat[Math.min(flat.length - 1, at + 1)]!.node.id);
    else if (key === "ArrowUp") move(flat[Math.max(0, at - 1)]!.node.id);
    else if (key === "Home") move(flat[0]!.node.id);
    else if (key === "End") move(flat[flat.length - 1]!.node.id);
    else if (key === "ArrowRight") {
      if (cur.node.children.length && !expanded(cur.node)) setOpen({ ...open, [cur.node.id]: true });
      else if (cur.node.children.length) move(cur.node.children[0]!.id);
    } else if (key === "ArrowLeft") {
      if (cur.node.children.length && expanded(cur.node)) setOpen({ ...open, [cur.node.id]: false });
      else if (cur.parent) move(cur.parent);
    } else if (key === "Enter" || key === " ") activate(cur.node);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const siblingsOf = (f: Flat): readonly OutlineNode[] => (f.parent === null ? items : (flat.find((x) => x.node.id === f.parent)?.node.children ?? []));

  // ---- dragging a bookmark to a new place or into another bookmark ----------------------------------------------------

  const dropOn = (e: ReactDragEvent, row: Flat): Drop | null => {
    if (!edit || !dragId) return null;
    const dragged = flat.find((f) => f.node.id === dragId);
    if (!dragged || hasInside(dragged.node, row.node.id)) return null;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = box.height > 0 ? (e.clientY - box.top) / box.height : 0.5;
    return { id: row.node.id, where: f < 0.28 ? "before" : f > 0.72 ? "after" : "into" };
  };
  const commitDrop = (target: Drop) => {
    const from = flat.find((f) => f.node.id === dragId);
    const to = flat.find((f) => f.node.id === target.id);
    if (!edit || !from || !to) return;
    focusAfter.current = from.node.id;
    if (target.where === "into") {
      setOpen((o) => ({ ...o, [to.node.id]: true }));
      edit.move(from.node.id, to.node.id, undefined);
      return;
    }
    // `move` counts among the parent's OTHER children, so a bookmark that moves down inside its own list counts one less.
    const same = from.parent === to.parent;
    const index = to.index + (target.where === "after" ? 1 : 0) - (same && from.index < to.index + (target.where === "after" ? 1 : 0) ? 1 : 0);
    edit.move(from.node.id, to.parent, index);
  };

  const stop = focus ?? flat[0]?.node.id;
  return (
    <>
      {toolbar}
      <div ref={root} className={className ? `pli-pdf-outline ${className}` : "pli-pdf-outline"} role="tree" aria-label="Outline" onKeyDown={onKeyDown}>
        {flat.map((row) => {
          const { node, level } = row;
          const hasKids = node.children.length > 0;
          const active = edit && focus === node.id;
          return (
            <div
              key={node.id}
              role="none"
              className="pli-pdf-outline-row"
              data-active={active ? "" : undefined}
              data-dragging={dragId === node.id ? "" : undefined}
              data-drop={drop?.id === node.id ? drop.where : undefined}
              draggable={edit && renaming !== node.id ? true : undefined}
              style={{ paddingLeft: 4 + (level - 1) * 14 }}
              onDragStart={(e) => {
                if (!edit) return;
                setDragId(node.id);
                e.dataTransfer?.setData("text/plain", node.title);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                const d = dropOn(e, row);
                if (!d) return;
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                setDrop((old) => (old?.id === d.id && old.where === d.where ? old : d));
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop((old) => (old?.id === node.id ? null : old));
              }}
              onDrop={(e) => {
                const d = dropOn(e, row);
                setDrop(null);
                if (!d) return;
                e.preventDefault();
                commitDrop(d);
                setDragId(null);
              }}
              onDragEnd={() => (setDragId(null), setDrop(null))}
            >
              <button
                type="button"
                className="pli-pdf-outline-toggle"
                tabIndex={-1}
                aria-label={hasKids ? (expanded(node) ? `Collapse ${node.title}` : `Expand ${node.title}`) : undefined}
                aria-hidden={hasKids ? undefined : true}
                disabled={!hasKids}
                onClick={() => setOpen({ ...open, [node.id]: !expanded(node) })}
              >
                {hasKids ? (expanded(node) ? I.caretDown : I.caretRight) : null}
              </button>
              {renaming === node.id ? (
                <input
                  className="pli-pdf-outline-input"
                  aria-label="Bookmark title"
                  defaultValue={node.title}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    edit?.rename(node.id, e.target.value);
                    setRenaming(null);
                    focusAfter.current = node.id;
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") e.currentTarget.blur();
                    else if (e.key === "Escape") {
                      e.currentTarget.value = node.title;
                      e.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="treeitem"
                  className="pli-pdf-outline-item"
                  data-id={node.id}
                  aria-level={level}
                  aria-expanded={hasKids ? expanded(node) : undefined}
                  tabIndex={node.id === stop ? 0 : -1}
                  style={{ fontWeight: node.bold ? 600 : undefined, fontStyle: node.italic ? "italic" : undefined, color: node.color }}
                  onClick={() => activate(node)}
                  onDoubleClick={() => edit && setRenaming(node.id)}
                  onFocus={() => setFocus(node.id)}
                >
                  {node.title || "Untitled"}
                </button>
              )}
              {edit && renaming !== node.id && (
                <span className="pli-pdf-outline-actions" role="group" aria-label={`Tools for ${node.title || "Untitled"}`}>
                  <button type="button" className="pli-pdf-outline-act" aria-label={`Rename ${node.title || "Untitled"}`} title="Rename (F2)" tabIndex={-1} onMouseDown={keepFocus} onClick={() => setRenaming(node.id)}>
                    {P.rename}
                  </button>
                  <button type="button" className="pli-pdf-outline-act" aria-label={`Send ${node.title || "Untitled"} to the page shown`} title="Go to the page shown" tabIndex={-1} onMouseDown={keepFocus} onClick={() => ((focusAfter.current = node.id), edit.retarget(node.id))}>
                    {P.target}
                  </button>
                  <button type="button" className="pli-pdf-outline-act" aria-label={`Indent ${node.title || "Untitled"}`} title="Indent (Alt+Shift+Right)" tabIndex={-1} disabled={row.index === 0} onMouseDown={keepFocus} onClick={() => ((focusAfter.current = node.id), edit.indent(node.id))}>
                    {P.indent}
                  </button>
                  <button type="button" className="pli-pdf-outline-act" aria-label={`Outdent ${node.title || "Untitled"}`} title="Outdent (Alt+Shift+Left)" tabIndex={-1} disabled={row.parent === null} onMouseDown={keepFocus} onClick={() => ((focusAfter.current = node.id), edit.outdent(node.id))}>
                    {P.outdent}
                  </button>
                  <button type="button" className="pli-pdf-outline-act" aria-label={`Delete ${node.title || "Untitled"}`} title="Delete" tabIndex={-1} onMouseDown={keepFocus} onClick={() => edit.remove(node.id)}>
                    {P.trash}
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
