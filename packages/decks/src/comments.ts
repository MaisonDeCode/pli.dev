import {
  CommentClient,
  PliError,
  type CommentChange,
  type CommentClientOptions,
  type CommentStore,
  type Thread,
  type Users,
} from "@pli.dev/core";
import type { Deck, DeckAnchor, Element, Paragraph, TableElement } from "./model";
import { applyDelta, docToParagraphs, paragraphsToDoc } from "./delta";
import { findElementDeep, type DeckOp } from "./ops";
import { withinOf } from "./normalize";
import type { DeckSession } from "./session";
import type { TextRange } from "./text";

/** How comments are set up. Without this, a session has no comments. */
export interface DeckCommentsOptions {
  /** Who is commenting, and who the authors of comments are. */
  users: Users;
  /**
   * Where comment threads are kept: `"document"` (the default) saves them inside the deck (and in the `.pptx` file as
   * comments, so PowerPoint and Google Slides show them), or a `CommentStore` of your own, such as a table in your database.
   */
  store?: CommentStore<DeckAnchor> | "document";
  permissions?: CommentClientOptions<DeckAnchor>["permissions"];
  onError?: CommentClientOptions<DeckAnchor>["onError"];
  /** Hook in your own notifications: called once for each comment action of this person, with who to tell and why. See `CommentNotice`. */
  onNotify?: CommentClientOptions<DeckAnchor>["onNotify"];
}

/** Where a thread is attached now: what is left of the slide, element and words it was made on. */
export interface AnchorState {
  /** The slide the thread belongs to, or null if it was deleted. */
  slide: string | null;
  /** The element, if the thread was made on one and it is still there. */
  element: string | null;
  /** The words, if the thread was made on some and they are still there: where they are now. */
  text: { from: number; to: number; cell?: [number, number] } | null;
  /**
   * What of the thread's place is gone, or null if all of it is there: `slide` (the slide was deleted: the thread is shown with
   * the deleted slides), `element` (shown on its slide) or `text` (the words were deleted: shown on its element).
   */
  orphan: "slide" | "element" | "text" | null;
}

/** Keeps comment threads inside the deck (`Deck.comments`). `write` applies a change without making an undo step. */
export function documentCommentStore(source: { readonly deck: { comments?: Record<string, Thread<DeckAnchor>> }; write(change: CommentChange<DeckAnchor>): void }): CommentStore<DeckAnchor> {
  const all = () => Object.values(source.deck.comments ?? {}).sort((a, b) => a.createdAt - b.createdAt);
  return {
    load: () => all(),
    save(_file, change: CommentChange<DeckAnchor>) {
      source.write(change);
    },
  };
}

/** The number of characters of a text body before a point, counting a paragraph break as one character. */
export function flatOffset(paragraphs: readonly Paragraph[], pos: { p: number; o: number }): number {
  let n = 0;
  for (let i = 0; i < pos.p && i < paragraphs.length; i++) n += paragraphs[i]!.runs.reduce((a, r) => a + r.text.length, 0) + 1;
  return n + pos.o;
}

/** The paragraph and offset of a flat position. */
export function textPosition(paragraphs: readonly Paragraph[], flat: number): { p: number; o: number } {
  let rest = flat;
  for (let i = 0; i < paragraphs.length; i++) {
    const len = paragraphs[i]!.runs.reduce((a, r) => a + r.text.length, 0);
    if (rest <= len) return { p: i, o: rest };
    rest -= len + 1;
  }
  const last = Math.max(0, paragraphs.length - 1);
  return { p: last, o: paragraphs[last]?.runs.reduce((a, r) => a + r.text.length, 0) ?? 0 };
}

const plain = (ps: readonly Paragraph[]) => ps.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
const QUOTE = 200;

/** The text containers of an element: its own text, or each cell of a table. */
function containers(el: Element): { cell?: [number, number]; paragraphs: Paragraph[] }[] {
  if (el.type === "shape") return el.text ? [{ paragraphs: el.text.paragraphs }] : [];
  if (el.type === "table") return (el as TableElement).rows.flatMap((r, ri) => r.cells.map((c, ci) => ({ cell: [ri, ci] as [number, number], paragraphs: c.paragraphs })));
  return [];
}

/** Where the words of a thread are in some text now, if its marks are there: one range, from the first marked character to the last. */
function markedRange(paragraphs: readonly Paragraph[], id: string): { from: number; to: number } | null {
  let pos = 0;
  let from = -1;
  let to = -1;
  for (const p of paragraphs) {
    for (const run of p.runs) {
      if (run.marks?.comment?.includes(id)) {
        if (from < 0) from = pos;
        to = pos + run.text.length;
      }
      pos += run.text.length;
    }
    pos += 1;
  }
  return from < 0 ? null : { from, to };
}

/** The ids of the threads attached to words in these paragraphs. */
export function commentIdsIn(paragraphs: readonly Paragraph[], into: Set<string> = new Set()): Set<string> {
  for (const p of paragraphs) for (const r of p.runs) for (const id of r.marks?.comment ?? []) into.add(id);
  return into;
}

/**
 * Comment threads (`@pli.dev/core` `CommentClient` with a `DeckAnchor`): `session.comments`. Turn them on with `enable`.
 * A thread is about a slide, an element on it, or words inside an element's text, and keeps its place when slides are
 * reordered, duplicated or deleted and when elements move; a thread whose place is gone is an orphan, shown on what is
 * left of it. Stores, servers and transports are the ones every Pli editor shares.
 */
export class CommentCommands {
  #client: CommentClient<DeckAnchor> | null = null;
  /** True while a change that came from the deck is being handed to the comment client, so it isn't written back. */
  #fromDeck = false;

  constructor(protected readonly session: DeckSession) {}

  /** The comments of this deck, or null if comments weren't turned on. */
  get client(): CommentClient<DeckAnchor> | null {
    return this.#client;
  }

  enable(options: DeckCommentsOptions): CommentClient<DeckAnchor> {
    const session = this.session;
    const inDeck = options.store === undefined || options.store === "document";
    // A thread kept in the deck is part of it. What this person does is a change like any other (not an undo step), so a
    // shared session (`SyncClient`) sends it; what arrives from the room is written as a remote change, which isn't sent again.
    const keep = (remote: boolean) =>
      documentCommentStore({
        get deck() {
          return session.deck;
        },
        write: (change) => {
          const ops: DeckOp[] = [{ type: "comment", change }];
          if (remote) session.applyRemote(ops);
          else session.transact(ops, { history: false });
        },
      });
    const documentStore = keep(false);
    const fromRoom = keep(true);
    const client = new CommentClient<DeckAnchor>({
      file: session.deck.id,
      users: options.users,
      store: inDeck ? documentStore : (options.store as CommentStore<DeckAnchor>),
      initial: Object.values(session.deck.comments ?? {}),
      permissions: options.permissions,
      onNotify: options.onNotify,
      onError: (error, change) => {
        if (change.type === "thread.create") this.#detach(change.thread.id);
        options.onError?.(error, change);
      },
    });
    client.onChange((change, origin) => {
      // Changes from the room are written into the deck, unless the deck is being kept in step by sync, which carries them.
      if (inDeck && origin === "remote" && !this.#fromDeck && !session.syncing) void fromRoom.save(session.deck.id, change);
      if (change.type === "thread.delete" && origin === "local") this.#detach(change.threadId);
    });
    session.subscribe((event) => {
      if (!inDeck) return;
      if (event.reset || ((event.origin === "undo" || event.origin === "redo") && event.ops.some((op) => op.type === "comment" || op.type === "set_thread"))) {
        void client.reload();
        return;
      }
      if (event.origin === "remote") {
        // Comments that came with other people's changes (sync) show in the panel.
        for (const op of event.ops) {
          if (op.type === "comment") {
            this.#fromDeck = true;
            try {
              client.receive(op.change);
            } finally {
              this.#fromDeck = false;
            }
          } else if (op.type === "set_thread") void client.reload();
        }
      }
    });
    this.#client = client;
    return client;
  }

  #need(): CommentClient<DeckAnchor> {
    if (!this.#client) throw new PliError("unsupported", "Comments aren't turned on: call session.comments.enable({ users })");
    return this.#client;
  }

  /** Takes the highlight of a thread off the text it is on. Not an undo step. */
  #detach(threadId: string): void {
    const ops = this.detachOps(threadId);
    if (ops.length > 0) this.session.transact(ops, { history: false });
  }

  // ---- Starting threads -------------------------------------------------------------------------------------------

  /** Starts a thread about a slide, at a place on it or none. */
  commentOnSlide(slideId: string, body: string, point?: { x: number; y: number }, mentions?: readonly string[]): Thread<DeckAnchor> {
    const client = this.#need();
    this.session.slide(slideId);
    return client.createThread(body, { slide: slideId, ...(point ? { point } : {}) }, undefined, mentions);
  }

  /** Starts a thread about an element (a shape, picture, table, chart or group). */
  commentOnElement(slideId: string, elementId: string, body: string, mentions?: readonly string[]): Thread<DeckAnchor> {
    const client = this.#need();
    const el = this.session.element(slideId, elementId);
    const quote = containers(el).map((c) => plain(c.paragraphs)).join(" ").trim().slice(0, QUOTE);
    return client.createThread(body, { slide: slideId, element: elementId, ...(quote ? { quote } : {}) }, undefined, mentions);
  }

  /**
   * Starts a thread about some words: they are marked, as one undo-less change, so the highlight stays with the words
   * while people edit around them. `cell` names the table cell the range is in.
   */
  commentOnText(slideId: string, elementId: string, range: TextRange, body: string, options: { cell?: [number, number]; mentions?: readonly string[] } = {}): Thread<DeckAnchor> {
    const client = this.#need();
    const el = this.session.element(slideId, elementId);
    const held = containers(el).find((c) => (options.cell ? c.cell?.[0] === options.cell[0] && c.cell[1] === options.cell[1] : !c.cell));
    if (!held) throw new PliError("invalid_operation", "That element has no text there");
    const from = flatOffset(held.paragraphs, range.from.p < range.to.p || (range.from.p === range.to.p && range.from.o <= range.to.o) ? range.from : range.to);
    const to = flatOffset(held.paragraphs, range.from.p < range.to.p || (range.from.p === range.to.p && range.from.o <= range.to.o) ? range.to : range.from);
    if (to <= from) return this.commentOnElement(slideId, elementId, body, options.mentions);
    const quote = plain(held.paragraphs).slice(from, to).slice(0, QUOTE);
    const thread = client.createThread(body, { slide: slideId, element: elementId, text: { from, to, ...(options.cell ? { cell: options.cell } : {}) }, ...(quote ? { quote } : {}) }, undefined, options.mentions);
    this.#mark(slideId, elementId, options.cell, from, to, thread.id, true);
    return thread;
  }

  #mark(slideId: string, elementId: string, cell: [number, number] | undefined, from: number, to: number, id: string, on: boolean): void {
    const within = withinOf(this.session.elementsOf(slideId), elementId) ?? [];
    this.session.transact(
      [{ type: "edit_text", owner: slideId, id: elementId, ...(within.length ? { within } : {}), ...(cell ? { cell } : {}), delta: [...(from > 0 ? [{ retain: from }] : []), { retain: to - from, attrs: { [`comment:${id}`]: on ? true : null } }] }],
      { history: false },
    );
  }

  /** The operations that take a thread's highlight off every text it is on. */
  detachOps(threadId: string): DeckOp[] {
    const ops: DeckOp[] = [];
    const deck = this.session.deck;
    const scan = (owner: string, list: readonly Element[], within: string[]) => {
      for (const el of list) {
        if (el.type === "group") scan(owner, el.children, [...within, el.id]);
        for (const c of containers(el)) {
          let pos = 0;
          const delta: { retain: number; attrs?: Record<string, unknown> }[] = [];
          let any = false;
          for (const p of c.paragraphs) {
            for (const run of p.runs) {
              if (run.marks?.comment?.includes(threadId)) {
                delta.push({ retain: run.text.length, attrs: { [`comment:${threadId}`]: null } });
                any = true;
              } else delta.push({ retain: run.text.length });
              pos += run.text.length;
            }
            delta.push({ retain: 1 });
            pos += 1;
          }
          if (any) ops.push({ type: "edit_text", owner, id: el.id, ...(within.length ? { within } : {}), ...(c.cell ? { cell: c.cell } : {}), delta: delta as never });
          void pos;
        }
      }
    };
    for (const s of deck.slides) scan(s.id, s.elements, []);
    return ops;
  }

  // ---- Reading where threads are --------------------------------------------------------------------------------

  /** Where a thread is attached now. */
  anchorState(thread: Thread<DeckAnchor>, deck: Deck = this.session.deck): AnchorState {
    const a = thread.anchor;
    if (!a) return { slide: null, element: null, text: null, orphan: "slide" };
    const slide = deck.slides.find((s) => s.id === a.slide);
    if (!slide) return { slide: null, element: null, text: null, orphan: "slide" };
    if (!a.element) return { slide: slide.id, element: null, text: null, orphan: null };
    const el = findElementDeep(slide.elements, a.element);
    if (!el) return { slide: slide.id, element: null, text: null, orphan: "element" };
    if (!a.text) return { slide: slide.id, element: el.id, text: null, orphan: null };
    for (const c of containers(el)) {
      const found = markedRange(c.paragraphs, thread.id);
      if (found) return { slide: slide.id, element: el.id, text: { ...found, ...(c.cell ? { cell: c.cell } : {}) }, orphan: null };
    }
    return { slide: slide.id, element: el.id, text: null, orphan: "text" };
  }

  /** The threads on a slide (the ones whose element or words are gone too, shown as orphans on it). */
  threadsOn(slideId: string): Thread<DeckAnchor>[] {
    return (this.#client?.threads ?? []).filter((t) => t.anchor?.slide === slideId);
  }

  /** The threads whose slide was deleted. */
  orphans(): Thread<DeckAnchor>[] {
    const deck = this.session.deck;
    return (this.#client?.threads ?? []).filter((t) => !t.anchor || !deck.slides.some((s) => s.id === t.anchor!.slide));
  }
}


/** The paragraphs with the words `from` to `to` (counting a paragraph break as one character) marked as part of a thread. */
export function markParagraphs(paragraphs: readonly Paragraph[], from: number, to: number, id: string, on = true): Paragraph[] {
  const delta = [...(from > 0 ? [{ retain: from }] : []), { retain: Math.max(0, to - from), attrs: { [`comment:${id}`]: on ? true : null } }];
  return docToParagraphs(applyDelta(paragraphsToDoc(paragraphs), delta));
}

/**
 * Marks the words of every thread that is about some (`anchor.text`) in a deck whose threads were just read from a file, and drops
 * the words from a thread when the element has no such text. The deck is changed in place.
 */
export function markCommentedText(deck: Deck): void {
  for (const thread of Object.values(deck.comments ?? {})) {
    const a = thread.anchor;
    if (!a?.text || !a.element) continue;
    const slide = deck.slides.find((s) => s.id === a.slide);
    const el = slide ? findElementDeep(slide.elements, a.element) : undefined;
    const held = el ? containers(el).find((c) => (a.text!.cell ? c.cell?.[0] === a.text!.cell[0] && c.cell[1] === a.text!.cell[1] : !c.cell)) : undefined;
    const length = held ? plain(held.paragraphs).length : 0;
    if (!el || !held || a.text.from >= length) {
      delete a.text;
      continue;
    }
    const to = Math.min(a.text.to, length);
    const marked = markParagraphs(held.paragraphs, a.text.from, to, thread.id);
    if (el.type === "shape" && el.text && !a.text.cell) el.text = { ...el.text, paragraphs: marked };
    else if (el.type === "table" && a.text.cell) {
      const [r, c] = a.text.cell;
      el.rows[r]!.cells[c] = { ...el.rows[r]!.cells[c]!, paragraphs: marked };
    }
  }
}

/** Takes every comment highlight off the text of an element (in place). A copy of an element doesn't carry its original's threads. */
export function stripCommentMarks(el: Element): void {
  const strip = (ps: Paragraph[]) => {
    for (const p of ps)
      for (const r of p.runs)
        if (r.marks?.comment) {
          const { comment: _c, ...rest } = r.marks;
          if (Object.keys(rest).length > 0) r.marks = rest;
          else delete r.marks;
        }
  };
  if (el.type === "shape" && el.text) strip(el.text.paragraphs);
  else if (el.type === "table") for (const row of el.rows) for (const c of row.cells) strip(c.paragraphs);
  else if (el.type === "group") el.children.forEach(stripCommentMarks);
}
