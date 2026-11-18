import { CommentClient, PliError, reloadCommentsOnHistory, type CommentClientOptions, type CommentStore, type Thread, type Users } from "@pli.dev/core";
import { cellAddress, parseCell, parseRange, rangeAddress } from "./address";
import type { Cell, CellAnchor, Sheet, Workbook } from "./model";
import type { SheetOp } from "./ops";
import type { SheetSession } from "./session";

/**
 * Threaded comments on cells (Excel's "Comments", as opposed to the classic yellow "Notes"). A thread belongs to a cell: the
 * cell carries its id (`Cell.thread`), so the thread goes wherever the cell goes (rows and columns inserted or deleted,
 * sorting, moving, a renamed sheet) with nothing extra to maintain. The conversation itself is `Thread<CellAnchor>` of
 * `@pli.dev/core`, kept inside the workbook (`Workbook.comments`, which travels with the file and with live editing) or in a
 * `CommentStore` of your own.
 */

/** How comments are set up. Without this, a session has no comments. */
export interface SheetCommentsOptions {
  /** Who is commenting, and who the authors of comments are. */
  users: Users;
  /**
   * Where comment threads are kept: `"document"` (the default) saves them in the workbook (and in an `.xlsx` file as
   * threaded comments, so Excel shows them), or a `CommentStore` of your own, such as a table in your database.
   */
  store?: CommentStore<CellAnchor> | "document";
  permissions?: CommentClientOptions<CellAnchor>["permissions"];
  onError?: CommentClientOptions<CellAnchor>["onError"];
  /** Hook in your own notifications: called once for each comment action of this person, with who to tell and why. See `CommentNotice`. */
  onNotify?: CommentClientOptions<CellAnchor>["onNotify"];
}

/** Where a thread is now: the cell that carries it. */
export interface ThreadPlace {
  /** The id of the sheet. */
  sheet: string;
  /** The cell, such as `B3`. */
  cell: string;
  /** The range the thread was made on, kept with the cell. Only the top left cell moves with the sheet. */
  range?: string;
}

const markerCache = new WeakMap<Workbook, Map<string, ThreadPlace>>();

/** The place of every thread that has a cell: the cell is the thread's anchor, so this is where each one is now. */
export function threadPlaces(wb: Workbook): Map<string, ThreadPlace> {
  let found = markerCache.get(wb);
  if (found) return found;
  found = new Map();
  for (const sheet of wb.sheets) {
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (cell.thread !== undefined && !found.has(cell.thread)) found.set(cell.thread, { sheet: sheet.id, cell: address });
    }
  }
  markerCache.set(wb, found);
  return found;
}

/** Where a thread is attached in the workbook as it is now (with its range, if it had one), or null when its cell is gone. */
export function placeOfThread(wb: Workbook, thread: Thread<CellAnchor>): ThreadPlace | null {
  const at = threadPlaces(wb).get(thread.id);
  if (!at) return null;
  const range = thread.anchor?.range;
  if (!range) return at;
  // The range keeps its size; it starts where the thread's cell is now.
  const was = thread.anchor?.cell ? parseCell(thread.anchor.cell) : null;
  const b = parseRange(range);
  const now = parseCell(at.cell);
  if (!was || !b || !now) return at;
  return { ...at, range: rangeAddress({ r1: now.row, c1: now.col, r2: now.row + (b.r2 - b.r1), c2: now.col + (b.c2 - b.c1) }) };
}

/**
 * A cell that was copied (not moved) carries the same thread as the one it was copied from; a thread belongs to one cell,
 * so the copy goes without it. Returns the operations with the duplicate markers taken off, or the same list.
 */
export function withoutDuplicateThreads(wb: Workbook, ops: readonly SheetOp[]): readonly SheetOp[] {
  if (!ops.some((o) => o.type === "set_cells")) return ops;
  const places = threadPlaces(wb);
  if (places.size === 0) return ops;
  // Where each thread's marker is after the operations: the ones that are already there and aren't written over, and the ones written.
  const after = new Map<string, Set<string>>();
  const at = (sheet: string, address: string) => `${sheet}|${address}`;
  for (const [id, place] of places) after.set(id, new Set([at(place.sheet, place.cell)]));
  for (const op of ops) {
    if (op.type !== "set_cells") continue;
    for (const [address, cell] of Object.entries(op.cells)) {
      const key = at(op.sheet, address);
      const had = wb.sheets.find((s) => s.id === op.sheet)?.cells[address]?.thread;
      if (had !== undefined) after.get(had)?.delete(key);
      if (cell?.thread !== undefined) {
        let set = after.get(cell.thread);
        if (!set) after.set(cell.thread, (set = new Set()));
        set.add(key);
      }
    }
  }
  const crowded = [...after].filter(([, set]) => set.size > 1);
  if (crowded.length === 0) return ops;
  const strip = new Set<string>();
  for (const [id, set] of crowded) {
    const home = places.get(id);
    const homeKey = home ? at(home.sheet, home.cell) : undefined;
    // The one that was there first stays; if it moved, the first written is the thread's cell.
    const keep = homeKey && set.has(homeKey) ? homeKey : [...set][0]!;
    for (const key of set) if (key !== keep) strip.add(`${id}@${key}`);
  }
  return ops.map((op) => {
    if (op.type !== "set_cells") return op;
    let cells: Record<string, Cell | null> | undefined;
    for (const [address, cell] of Object.entries(op.cells)) {
      if (cell?.thread !== undefined && strip.has(`${cell.thread}@${at(op.sheet, address)}`)) {
        const { thread: _thread, ...rest } = cell;
        (cells ??= { ...op.cells })[address] = Object.keys(rest).length ? rest : null;
      }
    }
    return cells ? { ...op, cells } : op;
  });
}

const QUOTE = 200;

/** What the cell shows as text, for the quote kept with a thread. */
const quoteOf = (cell: Cell | undefined): string | undefined => {
  if (!cell) return undefined;
  const text = cell.f !== undefined ? `=${cell.f}` : cell.v !== undefined ? String(cell.v) : cell.e;
  return text ? text.slice(0, QUOTE) : undefined;
};

/**
 * Comment threads (`@pli.dev/core` `CommentClient` with a `CellAnchor`): `session.comments`. Turn them on with `enable`.
 * Threads and notes both work on the same cell, as in Excel; `noteToComment` and `commentToNote` convert.
 */
export class CommentCommands {
  #client: CommentClient<CellAnchor> | null = null;
  /** True while a change that came with the workbook is being handed to the comment client, so it isn't written back. */
  #fromSession = false;
  /** Threads that were taken off the sheet by undo (their first comment was theirs alone), to be put back by redo. */
  readonly #undone = new Map<string, Thread<CellAnchor>>();

  constructor(protected readonly session: SheetSession) {}

  /** The comments of this workbook, or null if comments weren't turned on. */
  get client(): CommentClient<CellAnchor> | null {
    return this.#client;
  }

  enable(options: SheetCommentsOptions): CommentClient<CellAnchor> {
    if (this.#client) return this.#client;
    const session = this.session;
    const core = session.session;
    const inBook = options.store === undefined || options.store === "document";
    // A thread kept in the workbook is part of it. What this person does is a change like any other (not an undo step), so a
    // shared session (`SyncClient`) sends it; what arrives from the room is written as a remote change, which isn't sent again.
    const asOps = (remote: boolean): CommentStore<CellAnchor> => ({
      load: () => Object.values(session.state.comments ?? {}).sort((a, b) => a.createdAt - b.createdAt),
      // One `comment` operation per change: sync merges them, so a reply made at the same moment as another is kept.
      save: (_file, change) => core.transact([{ type: "comment", change }], remote ? { origin: "remote" } : { history: false }),
    });
    const documentStore = asOps(false);
    const fromRoom = asOps(true);
    const client = new CommentClient<CellAnchor>({
      file: session.state.id,
      users: options.users,
      store: inBook ? documentStore : (options.store as CommentStore<CellAnchor>),
      initial: Object.values(session.state.comments ?? {}),
      permissions: options.permissions,
      onNotify: options.onNotify,
      onError: (error, change) => {
        if (change.type === "thread.create") this.#detach(change.thread.id);
        options.onError?.(error, change);
      },
    });
    client.onChange((change, origin) => {
      // Changes from the room are written into the workbook, unless it is being kept in step by sync, which carries them.
      if (inBook && origin === "remote" && !this.#fromSession && !session.syncing) void fromRoom.save(session.state.id, change);
      if (change.type === "thread.delete" && origin === "local") this.#detach(change.threadId);
    });
    if (inBook) {
      reloadCommentsOnHistory(client, core, (op) => op.type === "set_thread" || op.type === "comment");
      core.subscribe((event) => {
        if (event.origin !== "remote") return;
        // Comments that came with other people's changes (sync) show in the panel.
        for (const op of event.ops) {
          if (op.type === "comment") {
            this.#fromSession = true;
            try {
              client.receive(op.change);
            } finally {
              this.#fromSession = false;
            }
          } else if (op.type === "set_thread") void client.reload();
        }
      });
    }
    let before = session.state;
    core.subscribe((event) => {
      if (event.origin === "undo" || event.origin === "redo") this.#followHistory(client, before, event.state, event.origin);
      before = event.state;
    });
    this.#client = client;
    return client;
  }

  #need(): CommentClient<CellAnchor> {
    if (!this.#client) throw new PliError("unsupported", "Comments aren't turned on: call session.comments.enable({ users })");
    return this.#client;
  }

  /** A thread whose cell was written away loses its marker everywhere (the thread itself goes with `deleteThread`). */
  #detach(threadId: string): void {
    const ops: SheetOp[] = [];
    for (const sheet of this.session.state.sheets) {
      for (const [address, cell] of Object.entries(sheet.cells)) {
        if (cell.thread === threadId) {
          const { thread: _t, ...rest } = cell;
          ops.push({ type: "set_cells", sheet: sheet.id, cells: { [address]: Object.keys(rest).length ? rest : null } });
        }
      }
    }
    if (ops.length) this.session.session.transact(ops, { history: false });
  }

  /**
   * Undoing the start of a thread takes the thread off its cell; the thread nobody else has written to goes with it, and comes
   * back when the start is redone.
   */
  #followHistory(client: CommentClient<CellAnchor>, before: Workbook, after: Workbook, origin: "undo" | "redo"): void {
    if (origin === "undo") {
      const was = threadPlaces(before);
      const now = threadPlaces(after);
      for (const thread of client.threads) {
        const me = client.users.current?.id;
        if (was.has(thread.id) && !now.has(thread.id) && thread.comments.length === 1 && thread.comments[0]!.author === me && client.can("deleteThread", thread)) {
          this.#undone.set(thread.id, thread);
          client.deleteThread(thread.id);
        }
      }
    } else {
      const now = threadPlaces(after);
      for (const [id, thread] of [...this.#undone]) {
        if (!now.has(id)) continue;
        this.#undone.delete(id);
        if (!client.thread(id)) client.createThread(thread.comments[0]!.body, thread.anchor, id, thread.comments[0]!.mentions);
      }
    }
  }

  // ---- Starting threads -------------------------------------------------------------------------------------------

  /** Starts a thread on a cell, as one undo step (the cell gets the thread's id). Returns the thread. */
  commentOn(sheet: string, address: string, body: string, mentions?: readonly string[]): Thread<CellAnchor> {
    return this.commentOnRange(sheet, address, body, mentions);
  }

  /** Starts a thread on a range: it sits on the range's top left cell, and keeps the range for its outline. */
  commentOnRange(sheet: string, range: string, body: string, mentions?: readonly string[]): Thread<CellAnchor> {
    const client = this.#need();
    const s = this.session.sheet(sheet);
    const b = parseRange(range);
    if (!b) throw new PliError("out_of_range", `"${range}" is not a range`);
    const cell = cellAddress(b.r1, b.c1);
    if (s.cells[cell]?.thread !== undefined && client.thread(s.cells[cell]!.thread!)) throw new PliError("invalid_operation", `${cell} already has a comment: reply to it`);
    const multi = b.r2 > b.r1 || b.c2 > b.c1;
    const quote = quoteOf(s.cells[cell]);
    const anchor: CellAnchor = { sheet: s.id, cell, ...(multi ? { range: rangeAddress(b) } : {}), ...(quote ? { quote } : {}) };
    const thread = client.createThread(body, anchor, undefined, mentions);
    this.session.transact([{ type: "set_cells", sheet: s.id, cells: { [cell]: { ...s.cells[cell], thread: thread.id } } }]);
    return thread;
  }

  // ---- Reading where threads are ----------------------------------------------------------------------------------

  /** Where a thread is now, or null if its cell is gone (a deleted row, column or sheet). */
  placeOf(threadId: string): ThreadPlace | null {
    const thread = this.#client?.thread(threadId);
    const place = threadPlaces(this.session.state).get(threadId);
    if (!place) return null;
    return thread ? placeOfThread(this.session.state, thread) : place;
  }

  /** Whether the thread's cell still exists. */
  isAttached(threadId: string): boolean {
    return threadPlaces(this.session.state).has(threadId);
  }

  /** The thread on a cell, if it has one. */
  threadAt(sheet: string, address: string): Thread<CellAnchor> | undefined {
    const pos = parseCell(address);
    if (!pos) return undefined;
    const id = this.session.sheet(sheet).cells[cellAddress(pos.row, pos.col)]?.thread;
    return id === undefined ? undefined : this.#client?.thread(id);
  }

  /** The threads on a sheet, in reading order (rows, then columns). */
  threadsOn(sheet: string): Thread<CellAnchor>[] {
    const s = this.session.sheet(sheet);
    const places = threadPlaces(this.session.state);
    const found: { thread: Thread<CellAnchor>; row: number; col: number }[] = [];
    for (const thread of this.#client?.threads ?? []) {
      const at = places.get(thread.id);
      if (!at || at.sheet !== s.id) continue;
      const p = parseCell(at.cell)!;
      found.push({ thread, row: p.row, col: p.col });
    }
    return found.sort((a, b) => a.row - b.row || a.col - b.col).map((f) => f.thread);
  }

  /** The threads whose cell is gone: shown by the panel as detached, and a thread's cell comes back with undo. */
  detached(): Thread<CellAnchor>[] {
    const places = threadPlaces(this.session.state);
    return (this.#client?.threads ?? []).filter((t) => !places.has(t.id));
  }

  /** Puts a detached thread on a cell. */
  attach(threadId: string, sheet: string, address: string): void {
    const client = this.#need();
    const thread = client.thread(threadId);
    if (!thread) throw new PliError("not_found", `No thread "${threadId}"`);
    const s = this.session.sheet(sheet);
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    const cell = cellAddress(pos.row, pos.col);
    const ops: SheetOp[] = [];
    const old = threadPlaces(this.session.state).get(threadId);
    if (old) {
      const oc = this.session.sheet(old.sheet).cells[old.cell]!;
      const { thread: _t, ...rest } = oc;
      ops.push({ type: "set_cells", sheet: old.sheet, cells: { [old.cell]: Object.keys(rest).length ? rest : null } });
    }
    ops.push({ type: "set_cells", sheet: s.id, cells: { [cell]: { ...s.cells[cell], thread: threadId } } });
    this.session.transact(ops);
  }

  // ---- Notes and comments -----------------------------------------------------------------------------------------

  /**
   * Turns a note into a threaded comment (Excel's "Convert to Comment"): the note's text becomes the first comment, written by
   * the note's author if they are a user of the editor, or by the current user, and the note is removed. One undo step.
   */
  noteToComment(sheet: string, address: string): Thread<CellAnchor> {
    const client = this.#need();
    const s = this.session.sheet(sheet);
    const pos = parseCell(address);
    const key = pos ? cellAddress(pos.row, pos.col) : address;
    const cell = s.cells[key];
    if (cell?.note === undefined) throw new PliError("invalid_operation", `There is no note on ${address}`);
    const body = cell.note;
    const quote = quoteOf({ ...cell, note: undefined });
    const thread = client.createThread(body, { sheet: s.id, cell: key, ...(quote ? { quote } : {}) });
    const { note: _n, noteRuns: _r, noteAuthor: _a, noteBox: _b, ...rest } = cell;
    this.session.transact([{ type: "set_cells", sheet: s.id, cells: { [key]: { ...rest, thread: thread.id } } }]);
    return thread;
  }

  /**
   * Turns a threaded comment into a note (Excel's "Convert to Note"): the conversation becomes the note's text, one line per
   * comment with its author, and the thread is deleted. One undo step.
   */
  commentToNote(sheet: string, address: string): void {
    const client = this.#need();
    const s = this.session.sheet(sheet);
    const pos = parseCell(address);
    const key = pos ? cellAddress(pos.row, pos.col) : address;
    const cell = s.cells[key];
    const thread = cell?.thread === undefined ? undefined : client.thread(cell.thread);
    if (!cell || !thread) throw new PliError("invalid_operation", `There is no comment on ${address}`);
    const text = thread.comments.map((c) => `${client.users.get(c.author).name}: ${c.body}`).join("\n");
    const { thread: _t, ...rest } = cell;
    this.session.transact([{ type: "set_cells", sheet: s.id, cells: { [key]: { ...rest, note: text, noteAuthor: client.users.current?.name } } }]);
    client.deleteThread(thread.id);
  }
}

/** Every thread of a workbook that has a cell on this sheet, with the cell: for exporting and for drawing indicators. */
export function threadCells(wb: Workbook, sheet: Sheet): { address: string; id: string }[] {
  const out: { address: string; id: string }[] = [];
  for (const [address, cell] of Object.entries(sheet.cells)) if (cell.thread !== undefined) out.push({ address, id: cell.thread });
  return out;
}
