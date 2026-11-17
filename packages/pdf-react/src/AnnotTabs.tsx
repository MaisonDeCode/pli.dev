import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Avatar, ThreadCard, timeAgo } from "@pli.dev/react";
import type { Thread } from "@pli.dev/core";
import type { Annotation, PdfAnchor } from "@pli.dev/pdf";
import { AnnotIcons as I } from "./annotIcons";
import { annotBounds } from "./annotGeometry";
import { describeType, type AnnotController } from "./annotController";
import type { PdfViewContext } from "./extensions";
import { useSessionRevision } from "./hooks";
import { useController } from "./annotUi";

/** The two sidebar tabs: Comments (threads and notes grouped by page, with filters) and Annotations (everything on the pages). */

const noop = () => {};

const ICONS: Record<Annotation["type"], ReactNode> = {
  highlight: I.highlight,
  underline: I.underline,
  strikeout: I.strikeout,
  squiggly: I.squiggly,
  ink: I.pen,
  square: I.rectangle,
  circle: I.ellipse,
  line: I.line,
  polygon: I.polygon,
  polyline: I.polyline,
  freetext: I.text,
  note: I.note,
  stamp: I.stamp,
  signature: I.signature,
  image: I.image,
  link: I.link,
  redact: I.redact,
};

/** The text that stands for an annotation in a list: its quote, comment or text, else what it is. */
export function annotLabel(a: Annotation): string {
  const text = a.type === "freetext" ? a.text : (a.contents ?? ("quote" in a ? a.quote : undefined) ?? (a.type === "stamp" && !("picture" in a.stamp) ? (a.stamp.label ?? a.stamp.name) : undefined) ?? (a.type === "link" ? (a.uri ?? "Link in this document") : undefined));
  const t = text?.trim().replace(/\s+/g, " ");
  return t ? (t.length > 80 ? `${t.slice(0, 79)}…` : t) : describeType(a.type);
}

type Filter = "all" | "mine" | "unresolved";

interface Entry {
  key: string;
  page: number;
  y: number;
  x: number;
  annot?: Annotation;
  thread?: Thread<PdfAnchor>;
}

function useThreads(c: AnnotController): readonly Thread<PdfAnchor>[] {
  const client = c.client;
  return useSyncExternalStore(
    (l) => (client ? client.subscribe(l) : noop),
    () => client?.threads ?? EMPTY,
    () => client?.threads ?? EMPTY,
  );
}
const EMPTY: readonly Thread<PdfAnchor>[] = [];

/** Threads and commented annotations by page. Works with `session.comments.client` when comments are on; else lists the text of annotations. */
export function CommentsTab({ c, view }: { c: AnnotController; view: PdfViewContext }) {
  c.setView(view);
  useSessionRevision(c.session);
  useController(c);
  const client = c.client;
  const threads = useThreads(c);
  const [filter, setFilter] = useState<Filter>("all");
  const doc = c.session.doc;
  const me = c.users.current?.id ?? c.user?.id;

  const entries = useMemo(() => {
    const out: Entry[] = [];
    const byThread = new Map<string, Thread<PdfAnchor>>(threads.map((t) => [t.id, t]));
    doc.pages.forEach((page, index) => {
      for (const a of page.annots) {
        const thread = a.thread ? byThread.get(a.thread) : undefined;
        if (thread) {
          byThread.delete(thread.id);
          const b = annotBounds(a);
          out.push({ key: `t:${thread.id}`, page: index, y: b.y, x: b.x, annot: a, thread });
        } else if (a.contents && a.contents.trim()) {
          const b = annotBounds(a);
          out.push({ key: `a:${a.id}`, page: index, y: b.y, x: b.x, annot: a });
        }
      }
    });
    // Threads whose annotation is gone, or that were never tied to one.
    for (const thread of byThread.values()) {
      const index = Math.max(0, doc.pages.findIndex((p) => p.id === thread.anchor?.page));
      out.push({ key: `t:${thread.id}`, page: index, y: thread.anchor?.y ?? 0, x: thread.anchor?.x ?? 0, thread });
    }
    return out.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  }, [doc, threads]);

  const mine = (e: Entry) => (e.thread ? e.thread.comments.some((m) => m.author === me) : e.annot?.author === me);
  const visible = entries.filter((e) => (filter === "mine" ? mine(e) : filter === "unresolved" ? !e.thread?.resolved : true));
  const unresolved = entries.filter((e) => !e.thread?.resolved).length;
  const selectedThread = c.selected.length === 1 ? c.selected[0]!.thread : undefined;
  const [active, setActive] = useState<string | null>(null);
  const activeId = selectedThread ?? active;

  const groups = new Map<number, Entry[]>();
  for (const e of visible) groups.set(e.page, [...(groups.get(e.page) ?? []), e]);
  const filters: [Filter, string][] = [
    ["all", "All"],
    ["mine", "Mine"],
    ["unresolved", "Unresolved"],
  ];

  return (
    <div className="pli-pdf-comments" aria-label="Comments">
      <div className="pli-pdf-comments-head">
        <strong>Comments</strong>
        <span className="pli-comments-count" aria-label={`${unresolved} unresolved`}>
          {unresolved}
        </span>
      </div>
      <div className="pli-pdf-filters" role="group" aria-label="Show comments">
        {filters.map(([id, label]) => (
          <button key={id} type="button" className="pli-fonts-kind" aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      {!client && <p className="pli-comments-note">Comments are not turned on for this document, so this list is read-only. It shows the text of notes and annotations.</p>}
      <div className="pli-pdf-comments-list">
        {visible.length === 0 && <p className="pli-comments-note">{filter === "all" ? "No comments yet." : "No comments match."}</p>}
        {[...groups.entries()].map(([page, list]) => (
          <section key={page} aria-label={`Page ${page + 1}`}>
            <h3 className="pli-pdf-pagehead">Page {page + 1}</h3>
            <ul className="pli-thread-list">
              {list.map((e) =>
                e.thread && client ? (
                  <ThreadCard
                    key={e.key}
                    client={client}
                    thread={e.thread}
                    active={e.thread.id === activeId}
                    attached={!!e.annot}
                    missing="The annotation was deleted"
                    fallbackQuote={e.annot ? describeType(e.annot.type) : "Comment"}
                    quoteLabel="Go to the annotation"
                    onActivate={() => {
                      setActive(e.thread!.id);
                      if (e.annot) c.reveal(e.annot.id);
                      else view.goToPage(e.thread!.anchor?.page ?? "", e.thread!.anchor?.y);
                    }}
                  />
                ) : e.annot ? (
                  <PlainItem key={e.key} c={c} annot={e.annot} active={c.selectedIds.includes(e.annot.id)} />
                ) : null,
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function PlainItem({ c, annot, active }: { c: AnnotController; annot: Annotation; active: boolean }) {
  const author = annot.author ? c.users.get(annot.author) : null;
  const name = author?.name ?? annot.authorName ?? "Someone";
  const when = annot.modified ?? annot.created;
  return (
    <li className="pli-thread" data-active={active || undefined} data-annot-item={annot.id}>
      <button type="button" className="pli-thread-quote" onClick={() => c.reveal(annot.id)} aria-label={`Go to the ${describeType(annot.type).toLowerCase()}`}>
        {"quote" in annot && annot.quote ? annot.quote : describeType(annot.type)}
      </button>
      <div className="pli-comment-head">
        {author ? <Avatar user={author} size={22} /> : null}
        <span className="pli-comment-author">{name}</span>
        {when ? (
          <time className="pli-comment-time" dateTime={new Date(when).toISOString()}>
            {timeAgo(when)}
          </time>
        ) : null}
      </div>
      <p className="pli-comment-body">{annot.contents}</p>
    </li>
  );
}

/** Every annotation of the document, by page: its icon, kind, author and time. A click goes to it and selects it. */
export function AnnotationsTab({ c, view }: { c: AnnotController; view: PdfViewContext }) {
  c.setView(view);
  useSessionRevision(c.session);
  useController(c);
  const [type, setType] = useState<string>("all");
  const doc = c.session.doc;
  const selected = new Set(c.selectedIds);
  const types = [...new Set(doc.pages.flatMap((p) => p.annots.map((a) => a.type)))].sort();
  const total = doc.pages.reduce((n, p) => n + p.annots.length, 0);
  return (
    <div className="pli-pdf-annotlist" aria-label="Annotations">
      <div className="pli-pdf-comments-head">
        <strong>Annotations</strong>
        <span className="pli-comments-count">{total}</span>
        <select aria-label="Show kind" value={type} onChange={(e) => setType(e.target.value)} className="pli-pdf-kindfilter">
          <option value="all">All kinds</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {describeType(t)}
            </option>
          ))}
        </select>
      </div>
      <div className="pli-pdf-comments-list">
        {total === 0 && <p className="pli-comments-note">Nothing has been added to this document yet.</p>}
        {doc.pages.map((page, index) => {
          const list = page.annots.filter((a) => type === "all" || a.type === type);
          if (list.length === 0) return null;
          return (
            <section key={page.id} aria-label={`Page ${index + 1}`}>
              <h3 className="pli-pdf-pagehead">Page {index + 1}</h3>
              <ul className="pli-pdf-annotrows">
                {list.map((a) => {
                  const when = a.modified ?? a.created;
                  const who = a.authorName ?? (a.author ? c.users.get(a.author).name : undefined);
                  return (
                    <li key={a.id}>
                      <button type="button" className="pli-pdf-annotrow" aria-pressed={selected.has(a.id)} data-annot-row={a.id} onClick={() => c.reveal(a.id)}>
                        <span className="pli-pdf-annoticon" aria-hidden="true">
                          {ICONS[a.type]}
                        </span>
                        <span className="pli-pdf-annottext">
                          <span className="pli-pdf-annottype">{describeType(a.type)}</span>
                          <span className="pli-pdf-annotlabel">{annotLabel(a) === describeType(a.type) ? "" : annotLabel(a)}</span>
                          <span className="pli-pdf-annotmeta">
                            Page {index + 1}
                            {who ? ` · ${who}` : ""}
                            {when ? ` · ${timeAgo(when)}` : ""}
                            {a.locked ? " · Locked" : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
