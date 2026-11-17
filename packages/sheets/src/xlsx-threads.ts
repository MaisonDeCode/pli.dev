import { attr, child, childrenNamed, textOf, type XmlElement, type Thread } from "@pli.dev/core";
import { cellAddress, parseCell } from "./address";
import type { Cell, CellAnchor, Sheet, Workbook } from "./model";

/**
 * Threaded comments in an `.xlsx` file, the way Excel 365 writes them: a part of the sheet (`xl/threadedComments/threadedCommentN.xml`)
 * with the comments and their replies, a list of the people who wrote them (`xl/persons/person.xml`), and, for older versions of
 * Excel, a classic note on the cell that says `[Threaded comment]` and holds the text (written by the author `tc={id}`).
 * A resolved thread is `done="1"`, and a mention is a `mention` element with where it starts in the text.
 *
 * The comment author is the Pli user id (kept in the person's `userId`; the name is `displayName`), so the people of a file read
 * by Pli are the people who wrote it. Google Sheets writes threaded comments the same way when it exports, and reads them back.
 */

export const THREADED_NS = "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments";
export const THREADED_REL = "http://schemas.microsoft.com/office/2017/10/relationships/threadedComment";
export const PERSON_REL = "http://schemas.microsoft.com/office/2017/10/relationships/person";
export const THREADED_TYPE = "application/vnd.ms-excel.threadedcomments+xml";
export const PERSON_TYPE = "application/vnd.ms-excel.person+xml";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const GUID = /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/;

/** A GUID such as `{3F2504E0-4F89-11D3-9A0C-0305E82C3301}`: an id that already is one is kept, any other gives the same GUID every time. */
export function guidOf(id: string): string {
  const upper = id.toUpperCase();
  if (GUID.test(upper)) return upper;
  // Four independent 32-bit hashes of the id, laid out as a version 4 GUID.
  const words: number[] = [];
  for (let seed = 0; seed < 4; seed++) {
    let h = (0x811c9dc5 ^ (seed * 0x9e3779b1)) >>> 0;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    words.push(h);
  }
  const hex = words.map((w) => w.toString(16).padStart(8, "0")).join("");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}}`.toUpperCase();
}

/** The people who wrote the comments of a workbook, as `xl/persons/person.xml` lists them. */
export class PeopleList {
  readonly #people = new Map<string, { guid: string; userId: string; name: string }>();
  constructor(private readonly lookup?: (id: string) => { name: string } | undefined) {}

  guid(userId: string): string {
    let found = this.#people.get(userId);
    if (!found) {
      this.#people.set(userId, (found = { guid: guidOf(`person:${userId}`), userId, name: this.lookup?.(userId)?.name ?? userId }));
    }
    return found.guid;
  }

  name(userId: string): string {
    this.guid(userId);
    return this.#people.get(userId)!.name;
  }

  get size(): number {
    return this.#people.size;
  }

  xml(): string {
    const people = [...this.#people.values()].map((p) => `<person displayName="${esc(p.name)}" id="${p.guid}" userId="${esc(p.userId)}" providerId="None"/>`);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<personList xmlns="${THREADED_NS}" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${people.join("")}</personList>`;
  }
}

const PLACEHOLDER_HEAD = "[Threaded comment]\n\nYour version of Excel allows you to read this threaded comment; however, any edits to it will get removed if the file is opened in a newer version of Excel. Learn more: https://go.microsoft.com/fwlink/?linkid=870924\n\n";

/** The text of the classic note that stands for a thread in older versions of Excel. */
export function placeholderText(thread: Thread<CellAnchor>, people: PeopleList): string {
  const [first, ...replies] = thread.comments;
  if (!first) return "[Threaded comment]";
  return `${PLACEHOLDER_HEAD}Comment:\n    ${first.body.replace(/\n/g, "\n    ")}${replies.map((r) => `\nReply:\n    ${people.name(r.author)}: ${r.body.replace(/\n/g, "\n    ")}`).join("")}`;
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/\d\Z$/, "").replace("Z", "");

/** The threads that have a cell on this sheet, in reading order. */
function threadsOf(wb: Workbook, sheet: Sheet): { address: string; thread: Thread<CellAnchor> }[] {
  const out: { address: string; thread: Thread<CellAnchor>; row: number; col: number }[] = [];
  const seen = new Set<string>();
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const thread = cell.thread === undefined ? undefined : wb.comments?.[cell.thread];
    const pos = parseCell(address);
    if (!thread || !pos || !thread.comments.length || seen.has(thread.id)) continue;
    seen.add(thread.id);
    out.push({ address, thread, row: pos.row, col: pos.col });
  }
  return out.sort((a, b) => a.row - b.row || a.col - b.col);
}

/**
 * The sheet as the classic notes part should see it: every cell that has a thread holds the placeholder note (author `tc={id}`)
 * in place of any note it had, because Excel allows one or the other on a cell.
 */
export function withPlaceholders(wb: Workbook, sheet: Sheet, people: PeopleList): Sheet {
  const threads = threadsOf(wb, sheet);
  if (!threads.length) return sheet;
  const cells = { ...sheet.cells };
  for (const { address, thread } of threads) {
    const { noteRuns: _r, noteBox: _b, ...rest } = cells[address]!;
    cells[address] = { ...rest, note: placeholderText(thread, people), noteAuthor: `tc=${guidOf(thread.id)}` };
  }
  return { ...sheet, cells };
}

/** The `threadedCommentN.xml` part of a sheet, or null when it has no threads. */
export function threadedCommentsXml(wb: Workbook, sheet: Sheet, people: PeopleList): string | null {
  const threads = threadsOf(wb, sheet);
  if (!threads.length) return null;
  const items: string[] = [];
  for (const { address, thread } of threads) {
    const top = guidOf(thread.id);
    thread.comments.forEach((c, i) => {
      const mentions = (c.mentions ?? []).flatMap((userId) => {
        const name = people.name(userId);
        const at = c.body.toLowerCase().indexOf(`@${name}`.toLowerCase());
        return at < 0 ? [] : [`<mention mentionpersonId="${people.guid(userId)}" mentionId="${guidOf(`mention:${c.id}:${userId}`)}" startIndex="${at}" length="${name.length + 1}"/>`];
      });
      const done = i === 0 && thread.resolved ? ' done="1"' : i === 0 ? ' done="0"' : "";
      items.push(
        `<threadedComment ref="${address}" dT="${stamp(c.createdAt)}" personId="${people.guid(c.author)}" id="${i === 0 ? top : guidOf(c.id)}"${i === 0 ? "" : ` parentId="${top}"`}${done}>` +
          `<text>${esc(c.body)}</text>${mentions.length ? `<mentions>${mentions.join("")}</mentions>` : ""}</threadedComment>`,
      );
    });
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<ThreadedComments xmlns="${THREADED_NS}" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${items.join("")}</ThreadedComments>`;
}

// ---- reading ----

export interface ReadPerson {
  /** The user id: what the file's `userId` says, or the person's name when it says nothing. */
  id: string;
  name: string;
}

/** The people of `xl/persons/person.xml`, by the id the comments use. */
export function readPersons(root: XmlElement | undefined): Map<string, ReadPerson> {
  const out = new Map<string, ReadPerson>();
  for (const p of childrenNamed(root, "person")) {
    const guid = (attr(p, "id") ?? "").toUpperCase();
    const name = attr(p, "displayName") ?? "";
    const userId = attr(p, "userId");
    if (guid) out.set(guid, { id: userId && userId !== "" ? userId : name || guid, name: name || userId || guid });
  }
  return out;
}

/**
 * Reads a sheet's threaded comments into `threads` (by thread id) and puts each thread's id on its cell. A reply without
 * its first comment is dropped. Returns how many threads were read.
 */
export function readThreadedComments(root: XmlElement | undefined, sheet: Sheet, persons: ReadonlyMap<string, ReadPerson>, threads: Record<string, Thread<CellAnchor>>, warnings: Set<string>): number {
  if (!root) return 0;
  const all = childrenNamed(root, "threadedComment");
  const byId = new Map(all.map((c) => [(attr(c, "id") ?? "").toUpperCase(), c]));
  const roots = all.filter((c) => !attr(c, "parentId"));
  let count = 0;
  for (const top of roots) {
    const ref = (attr(top, "ref") ?? "").replace(/\$/g, "");
    const pos = parseCell(ref);
    const id = (attr(top, "id") ?? "").toUpperCase();
    if (!pos || !id) continue;
    const address = cellAddress(pos.row, pos.col);
    const replies = all.filter((c) => (attr(c, "parentId") ?? "").toUpperCase() === id);
    const comment = (c: XmlElement) => {
      const body = textOf(child(c, "text")).replace(/\r\n/g, "\n");
      const author = persons.get((attr(c, "personId") ?? "").toUpperCase())?.id ?? "unknown";
      const when = Date.parse(`${attr(c, "dT") ?? ""}Z`);
      const mentions = childrenNamed(child(c, "mentions"), "mention").flatMap((m) => {
        const who = persons.get((attr(m, "mentionpersonId") ?? "").toUpperCase());
        return who ? [who.id] : [];
      });
      return { id: (attr(c, "id") ?? "").toUpperCase(), author, body, createdAt: Number.isFinite(when) ? when : 0, ...(mentions.length ? { mentions: [...new Set(mentions)] } : {}) };
    };
    const comments = [comment(top), ...replies.sort((a, b) => Date.parse(`${attr(a, "dT")}Z`) - Date.parse(`${attr(b, "dT")}Z`)).map(comment)];
    const last = comments[comments.length - 1]!;
    const thread: Thread<CellAnchor> = {
      id,
      anchor: { sheet: sheet.id, cell: address, ...(sheet.cells[address] ? quote(sheet.cells[address]!) : {}) },
      comments,
      createdAt: comments[0]!.createdAt,
      ...(attr(top, "done") === "1" || attr(top, "done") === "true" ? { resolved: { by: last.author, at: last.createdAt } } : {}),
    };
    threads[id] = thread;
    sheet.cells[address] = { ...sheet.cells[address], thread: id };
    count++;
  }
  if (byId.size && !count) warnings.add("Threaded comments could not be read and were left out");
  return count;
}

const quote = (cell: Cell): { quote?: string } => {
  const text = cell.f !== undefined ? `=${cell.f}` : cell.v !== undefined ? String(cell.v) : undefined;
  return text ? { quote: text.slice(0, 200) } : {};
};
