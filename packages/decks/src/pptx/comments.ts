/**
 * Comments in a PPTX file, in both forms PowerPoint knows:
 *
 * - **legacy** (PowerPoint 2007 to 2019, read by every version and by Google Slides): `ppt/commentAuthors.xml` and one
 *   `ppt/comments/commentN.xml` per slide; a reply is a comment that names its parent in the `p15:threadingInfo` extension.
 * - **modern** (Microsoft 365): `ppt/authors.xml` and one `ppt/comments/modernComment_*.xml` per slide, with replies
 *   inside their comment, a resolved status, and the shape (or words) a comment is about.
 *
 * A thread is the first comment and its replies. What PowerPoint has no place for (which words of a shape, the people a
 * comment mentions, the ids of Pli's own threads and comments) is kept in an extension of our own that PowerPoint ignores,
 * so a deck written by Pli and read by Pli gives the same threads back.
 */
import { child, childrenNamed, elements, textOf, type Comment, type Thread, type XmlElement } from "@pli.dev/core";
import type { Deck, DeckAnchor } from "../model";
import { NS_A, NS_P, NS_R, tag } from "./emit";
import { Part, XML_DECL, xmlEscape, type OpcPackage } from "./opc";

/** Which form of comments to write. `none` leaves them out. */
export type CommentsMode = "legacy" | "modern" | "none";

/** Who an author of comments is, for the file: the name PowerPoint shows. */
export interface CommentAuthorInfo {
  name: string;
  initials?: string;
}

const NS_PLI = "https://pli.dev/ns/pptx-comments";
const NS_P15 = "http://schemas.microsoft.com/office/powerpoint/2012/main";
const NS_P188 = "http://schemas.microsoft.com/office/powerpoint/2018/8/main";
const NS_PC = "http://schemas.microsoft.com/office/powerpoint/2013/main/command";
const NS_AC = "http://schemas.microsoft.com/office/drawing/2013/main/command";
const EXT_THREADING = "{C676402C-5697-4E1C-873F-D02D1690AC5C}";
const EXT_PLI = "{6F2D3B3E-5D0E-4C1A-9B61-0C0F5A7B1D42}";
const REL_LEGACY_AUTHORS = `http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors`;
const REL_LEGACY_COMMENTS = `http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments`;
const REL_MODERN_AUTHORS = "http://schemas.microsoft.com/office/2018/10/relationships/authors";
const REL_MODERN_COMMENTS = "http://schemas.microsoft.com/office/2018/10/relationships/comments";
const CT_LEGACY_AUTHORS = "application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml";
const CT_LEGACY_COMMENTS = "application/vnd.openxmlformats-officedocument.presentationml.comments+xml";
const CT_MODERN_AUTHORS = "application/vnd.ms-powerpoint.authors+xml";
const CT_MODERN_COMMENTS = "application/vnd.ms-powerpoint.comments+xml";

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 3) || "?";

/** A GUID made from a name, so the same author always gets the same one. */
function guid(seed: string): string {
  const parts: string[] = [];
  for (let k = 0; k < 4; k++) {
    let h = 0x811c9dc5 ^ (k * 0x9e3779b1);
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    parts.push(h.toString(16).padStart(8, "0").toUpperCase());
  }
  const hex = parts.join("");
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`;
}

const isoLocal = (ms: number): string => new Date(ms).toISOString().replace("Z", "");
const isoZ = (ms: number): string => new Date(ms).toISOString();
const parseDate = (text: string | undefined): number => {
  if (!text) return 0;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
  return Number.isFinite(t) ? t : 0;
};

/** What the writer needs of a slide, filled in as slides are written. */
export interface SlideForComments {
  /** The slide's part. */
  part: Part;
  /** The `p:sldId` of the slide (256 and up). */
  sldId: number;
  /** The `cNvPr` id written for each element of the slide. */
  spids: ReadonlyMap<string, number>;
}

export interface CommentWriteOptions {
  mode: CommentsMode;
  author?: (id: string) => CommentAuthorInfo | undefined;
}

/** The threads that go in the file, by slide id. Threads of slides that are gone are left out. */
function threadsBySlide(deck: Deck): Map<string, Thread<DeckAnchor>[]> {
  const out = new Map<string, Thread<DeckAnchor>[]>();
  const ids = new Set(deck.slides.map((s) => s.id));
  for (const t of Object.values(deck.comments ?? {}).sort((a, b) => a.createdAt - b.createdAt)) {
    if (!t.anchor || !ids.has(t.anchor.slide) || t.comments.length === 0) continue;
    const list = out.get(t.anchor.slide) ?? [];
    list.push(t);
    out.set(t.anchor.slide, list);
  }
  return out;
}

/** Whether a slide has threads to write, so the writer remembers the shape ids it assigns. */
export function slideHasThreads(deck: Deck, slideId: string): boolean {
  return !!deck.comments && Object.values(deck.comments).some((t) => t.anchor?.slide === slideId && t.comments.length > 0);
}

const body = (text: string): string => text.split(/\r\n|\r|\n/).map((line) => tag("a:p", {}, line === "" ? tag("a:endParaRPr", { lang: "en-US" }) : tag("a:r", {}, tag("a:rPr", { lang: "en-US" }) + tag("a:t", {}, xmlEscape(line))))).join("");

function pliExt(thread: Thread<DeckAnchor>, c: Comment, first: boolean, spid: number | undefined): string {
  const a = thread.anchor!;
  return tag(
    "pli:c",
    {
      "xmlns:pli": NS_PLI,
      thread: thread.id,
      comment: c.id,
      user: c.author,
      spid,
      from: first ? a.text?.from : undefined,
      to: first ? a.text?.to : undefined,
      row: first ? a.text?.cell?.[0] : undefined,
      col: first ? a.text?.cell?.[1] : undefined,
      px: first ? a.point?.x : undefined,
      py: first ? a.point?.y : undefined,
      quote: first ? a.quote : undefined,
      resolved: first && thread.resolved ? 1 : undefined,
      by: first && thread.resolved ? thread.resolved.by : undefined,
      at: first && thread.resolved ? thread.resolved.at : undefined,
      created: c.createdAt,
      edited: c.editedAt,
      mentions: c.mentions?.length ? c.mentions.join(",") : undefined,
      tcreated: first ? thread.createdAt : undefined,
    },
  );
}

/** Adds the comment parts of a deck to the package. */
export function addCommentParts(pkg: OpcPackage, pres: Part, deck: Deck, slides: readonly SlideForComments[], options: CommentWriteOptions): void {
  if (options.mode === "none") return;
  const bySlide = threadsBySlide(deck);
  const used = new Map<string, number>(); // author id -> order
  for (const list of bySlide.values()) for (const t of list) for (const c of t.comments) if (!used.has(c.author)) used.set(c.author, used.size);
  if (used.size === 0) return;
  const info = (id: string): CommentAuthorInfo => options.author?.(id) ?? { name: id };
  const authors = [...used.keys()];

  if (options.mode === "legacy") {
    const last = new Map<string, number>(); // author -> last idx used
    const idxOf = new Map<string, number>(); // comment id -> idx
    const lists: { slide: SlideForComments; xml: string }[] = [];
    for (const [slideIndex, slide] of deck.slides.entries()) {
      const threads = bySlide.get(slide.id);
      const written = slides[slideIndex];
      if (!threads || !written) continue;
      const items: string[] = [];
      for (const t of threads) {
        const a = t.anchor!;
        const spid = a.element ? written.spids.get(a.element) : undefined;
        // The position: where the comment was put, else the top left of the element it is about, else the corner.
        const el = a.element ? slide.elements.find((e) => e.id === a.element) : undefined;
        const px = a.point?.x ?? el?.x ?? 0;
        const py = a.point?.y ?? el?.y ?? 0;
        const parent = t.comments[0]!;
        t.comments.forEach((c, i) => {
          const authorId = authors.indexOf(c.author);
          const idx = (last.get(c.author) ?? 0) + 1;
          last.set(c.author, idx);
          idxOf.set(c.id, idx);
          const threading =
            i === 0
              ? ""
              : tag("p:ext", { uri: EXT_THREADING }, tag("p15:threadingInfo", { "xmlns:p15": NS_P15, timeZoneBias: 0 }, tag("p15:parentCm", { authorId: authors.indexOf(parent.author), idx: idxOf.get(parent.id) })));
          const pli = tag("p:ext", { uri: EXT_PLI }, pliExt(t, c, i === 0, spid));
          items.push(
            tag(
              "p:cm",
              { authorId, dt: isoLocal(c.createdAt), idx },
              tag("p:pos", { x: Math.round(px * 8), y: Math.round(py * 8) }) + tag("p:text", {}, xmlEscape(c.body)) + tag("p:extLst", {}, threading + pli),
            ),
          );
        });
      }
      if (items.length > 0) lists.push({ slide: written, xml: `${XML_DECL}<p:cmLst xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">${items.join("")}</p:cmLst>` });
    }
    const authorXml = authors
      .map((id, i) => {
        const a = info(id);
        return tag("p:cmAuthor", { id: i, name: a.name, initials: a.initials ?? initialsOf(a.name), lastIdx: last.get(id) ?? 0, clrIdx: i % 10 });
      })
      .join("");
    const authorsPart = pkg.add(newPart("ppt/commentAuthors.xml", CT_LEGACY_AUTHORS, `${XML_DECL}<p:cmAuthorLst xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">${authorXml}</p:cmAuthorLst>`));
    pres.relate(REL_LEGACY_AUTHORS, authorsPart.name);
    lists.forEach(({ slide, xml }, n) => {
      const part = pkg.add(newPart(`ppt/comments/comment${n + 1}.xml`, CT_LEGACY_COMMENTS, xml));
      slide.part.relate(REL_LEGACY_COMMENTS, part.name);
    });
    return;
  }

  // Modern comments.
  const authorXml = authors
    .map((id) => {
      const a = info(id);
      return tag("p188:author", { id: guid(`author:${id}`), name: a.name, initials: a.initials ?? initialsOf(a.name), userId: a.name, providerId: "None" });
    })
    .join("");
  const authorsPart = pkg.add(newPart("ppt/authors.xml", CT_MODERN_AUTHORS, `${XML_DECL}<p188:authorLst xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" xmlns:p188="${NS_P188}">${authorXml}</p188:authorLst>`));
  pres.relate(REL_MODERN_AUTHORS, authorsPart.name);
  for (const [slideIndex, slide] of deck.slides.entries()) {
    const threads = bySlide.get(slide.id);
    const written = slides[slideIndex];
    if (!threads || !written) continue;
    const items = threads.map((t) => {
      const a = t.anchor!;
      const first = t.comments[0]!;
      const spid = a.element ? written.spids.get(a.element) : undefined;
      const sld = tag("pc:sldMk", { cId: 0, sldId: written.sldId });
      let anchor = tag("pc:sldMkLst", { "xmlns:pc": NS_PC }, tag("pc:docMk") + sld);
      if (spid !== undefined) {
        const sp = tag("ac:spMk", { id: spid, creationId: guid(`${slide.id}:${a.element}`) });
        anchor = a.text
          ? tag("ac:txMkLst", { "xmlns:pc": NS_PC, "xmlns:ac": NS_AC }, tag("pc:docMk") + sld + sp + tag("ac:txMk", { start: a.text.from, len: Math.max(0, a.text.to - a.text.from) }, tag("ac:context", { len: 0, hash: 0 })))
          : tag("ac:deMkLst", { "xmlns:pc": NS_PC, "xmlns:ac": NS_AC }, tag("pc:docMk") + sld + sp);
      }
      const replies = t.comments.slice(1).map((c) =>
        tag("p188:reply", { id: guid(`reply:${c.id}`), authorId: guid(`author:${c.author}`), created: isoZ(c.createdAt) }, tag("p188:txBody", {}, tag("a:bodyPr") + tag("a:lstStyle") + body(c.body)) + tag("p188:extLst", {}, tag("p:ext", { uri: EXT_PLI }, pliExt(t, c, false, undefined)))),
      );
      const pos = a.point ? tag("p188:pos", { x: Math.round(a.point.x * 12700), y: Math.round(a.point.y * 12700) }) : "";
      return tag(
        "p188:cm",
        { id: guid(`thread:${t.id}`), authorId: guid(`author:${first.author}`), created: isoZ(first.createdAt), status: t.resolved ? "resolved" : undefined },
        anchor +
          pos +
          (replies.length ? tag("p188:replyLst", {}, replies.join("")) : "") +
          tag("p188:txBody", {}, tag("a:bodyPr") + tag("a:lstStyle") + body(first.body)) +
          tag("p188:extLst", {}, tag("p:ext", { uri: EXT_PLI }, pliExt(t, first, true, spid))),
      );
    });
    const name = `ppt/comments/modernComment_${written.sldId.toString(16).toUpperCase()}_${guid(slide.id).slice(1, 9)}.xml`;
    const part = pkg.add(newPart(name, CT_MODERN_COMMENTS, `${XML_DECL}<p188:cmLst xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" xmlns:p188="${NS_P188}">${items.join("")}</p188:cmLst>`));
    written.part.relate(REL_MODERN_COMMENTS, part.name);
  }
}

function newPart(name: string, type: string, data: string): Part {
  return new Part(name, type, data);
}

// ---- Reading ---------------------------------------------------------------------------------------------------

/** What the reader needs of the package. */
export interface CommentSource {
  xml(path: string): XmlElement | undefined;
  find(path: string): string | undefined;
  rels(part: string): Map<string, { type: string; target: string; external: boolean }>;
}

export interface ReadSlide {
  /** The id the slide has in the deck. */
  id: string;
  /** Its part name. */
  path: string;
  /** The deck id of the element a shape id (`cNvPr`) names on this slide. */
  elementOf(spid: number): string | undefined;
  /** The paragraph and text of each element, for checking a words range (optional). */
  textLength?(elementId: string): number | undefined;
}

export interface ReadAuthor {
  name: string;
  initials?: string;
  userId?: string;
}

interface Raw {
  author: ReadAuthor;
  text: string;
  created: number;
  parent?: { author: string; idx: string };
  key: string;
  idx?: string;
  resolved?: boolean;
  spid?: number;
  point?: { x: number; y: number };
  ext?: Record<string, string>;
  replies?: Raw[];
  textRange?: { from: number; to: number };
}

const extOf = (el: XmlElement | undefined): Record<string, string> | undefined => {
  for (const ext of childrenNamed(child(el, "extLst"), "ext")) {
    const c = child(ext, "c");
    if (c && ext.attrs.uri === EXT_PLI) return c.attrs;
  }
  return undefined;
};

function paragraphsText(root: XmlElement | undefined): string {
  return childrenNamed(root, "p")
    .map((p) => elements(p).map((n) => (n.name === "br" ? "\n" : n.name === "r" || n.name === "fld" ? textOf(child(n, "t")) : "")).join(""))
    .join("\n");
}

const num = (v: string | undefined): number | undefined => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));

/** Reads the comments of every slide into threads. `author` turns the author in the file into the id of a user. */
export function readComments(src: CommentSource, presPath: string, slides: readonly ReadSlide[], author: (a: ReadAuthor, id?: string) => string, warn: (message: string) => void): Record<string, Thread<DeckAnchor>> {
  const out: Record<string, Thread<DeckAnchor>> = {};
  const presRels = [...src.rels(presPath).values()];
  const legacyAuthors = new Map<string, ReadAuthor>();
  const legacyRel = presRels.find((r) => r.type === "commentAuthors" && !r.external);
  const legacyRoot = legacyRel ? src.xml(legacyRel.target) : undefined;
  for (const a of childrenNamed(legacyRoot, "cmAuthor")) if (a.attrs.id !== undefined) legacyAuthors.set(a.attrs.id, { name: a.attrs.name ?? "Unknown", initials: a.attrs.initials });
  const modernAuthors = new Map<string, ReadAuthor>();
  const modernRel = presRels.find((r) => r.type === "authors" && !r.external);
  const modernRoot = modernRel ? src.xml(modernRel.target) : undefined;
  for (const a of childrenNamed(modernRoot, "author")) if (a.attrs.id) modernAuthors.set(a.attrs.id, { name: a.attrs.name ?? "Unknown", initials: a.attrs.initials, userId: a.attrs.userId });

  for (const slide of slides) {
    for (const rel of src.rels(slide.path).values()) {
      if (rel.type !== "comments" || rel.external) continue;
      const root = src.xml(rel.target);
      if (!root) continue;
      const cms = childrenNamed(root, "cm");
      if (cms.length === 0) continue;
      try {
        if (child(cms[0], "txBody")) readModern(cms, slide, modernAuthors, author, out);
        else readLegacy(cms, slide, legacyAuthors, author, out);
      } catch (cause) {
        warn(`Comments on a slide couldn't be read (${cause instanceof Error ? cause.message : "unknown error"}) and were skipped`);
      }
    }
  }
  return out;
}

function threadFrom(raw: Raw, slide: ReadSlide, author: (a: ReadAuthor, id?: string) => string, out: Record<string, Thread<DeckAnchor>>): void {
  const x = raw.ext;
  const all = [raw, ...(raw.replies ?? [])];
  const id = x?.thread || `th_${Math.random().toString(36).slice(2, 12)}`;
  if (out[id]) return;
  const anchor: DeckAnchor = { slide: slide.id };
  const spid = raw.spid ?? num(x?.spid);
  const element = spid === undefined ? undefined : slide.elementOf(spid);
  if (element) anchor.element = element;
  const from = num(x?.from) ?? raw.textRange?.from;
  const to = num(x?.to) ?? (raw.textRange ? raw.textRange.from + raw.textRange.to : undefined);
  if (element && from !== undefined && to !== undefined && to > from) {
    anchor.text = { from, to };
    const row = num(x?.row);
    const col = num(x?.col);
    if (row !== undefined && col !== undefined) anchor.text.cell = [row, col];
  }
  const px = num(x?.px) ?? raw.point?.x;
  const py = num(x?.py) ?? raw.point?.y;
  if (px !== undefined && py !== undefined && !element) anchor.point = { x: px, y: py };
  if (x?.quote) anchor.quote = x.quote;
  const comments: Comment[] = all.map((r, i) => {
    const e = r.ext;
    const c: Comment = { id: e?.comment || `cm_${Math.random().toString(36).slice(2, 12)}${i}`, author: author(r.author, e?.user), body: r.text, createdAt: num(e?.created) ?? r.created };
    const edited = num(e?.edited);
    if (edited !== undefined) c.editedAt = edited;
    if (e?.mentions) c.mentions = e.mentions.split(",").filter(Boolean);
    return c;
  });
  const thread: Thread<DeckAnchor> = { id, anchor, comments, createdAt: num(x?.tcreated) ?? comments[0]!.createdAt };
  if (raw.resolved || x?.resolved === "1") thread.resolved = { by: x?.by || comments[comments.length - 1]!.author, at: num(x?.at) ?? comments[comments.length - 1]!.createdAt };
  out[id] = thread;
}

function readLegacy(cms: XmlElement[], slide: ReadSlide, authors: Map<string, ReadAuthor>, author: (a: ReadAuthor, id?: string) => string, out: Record<string, Thread<DeckAnchor>>): void {
  const raws: Raw[] = [];
  for (const cm of cms) {
    const a = authors.get(cm.attrs.authorId ?? "") ?? { name: "Unknown" };
    const pos = child(cm, "pos");
    const x = num(pos?.attrs.x);
    const y = num(pos?.attrs.y);
    const threading = childrenNamed(child(cm, "extLst"), "ext")
      .map((e) => child(e, "threadingInfo"))
      .find(Boolean);
    const parentEl = child(threading, "parentCm");
    raws.push({
      author: a,
      text: textOf(child(cm, "text")),
      created: parseDate(cm.attrs.dt),
      key: `${cm.attrs.authorId}:${cm.attrs.idx}`,
      idx: cm.attrs.idx,
      parent: parentEl ? { author: parentEl.attrs.authorId ?? "", idx: parentEl.attrs.idx ?? "" } : undefined,
      point: x !== undefined && y !== undefined ? { x: x / 8, y: y / 8 } : undefined,
      ext: extOf(cm),
    });
  }
  const byKey = new Map(raws.map((r) => [r.key, r]));
  const roots: Raw[] = [];
  for (const r of raws) {
    const parent = r.parent ? byKey.get(`${r.parent.author}:${r.parent.idx}`) : undefined;
    if (parent && parent !== r) (parent.replies ??= []).push(r);
    else roots.push(r);
  }
  for (const r of roots) {
    r.replies?.sort((a, b) => a.created - b.created);
    threadFrom(r, slide, author, out);
  }
}

function readModern(cms: XmlElement[], slide: ReadSlide, authors: Map<string, ReadAuthor>, author: (a: ReadAuthor, id?: string) => string, out: Record<string, Thread<DeckAnchor>>): void {
  for (const cm of cms) {
    const a = authors.get(cm.attrs.authorId ?? "") ?? { name: "Unknown" };
    const spMk = (list: XmlElement | undefined) => child(list, "spMk");
    const anchorEl = elements(cm).find((e) => e.name === "txMkLst" || e.name === "deMkLst");
    const sp = spMk(anchorEl);
    const txMk = child(anchorEl, "txMk");
    const pos = child(cm, "pos");
    const x = num(pos?.attrs.x);
    const y = num(pos?.attrs.y);
    const raw: Raw = {
      author: a,
      text: paragraphsText(child(cm, "txBody")),
      created: parseDate(cm.attrs.created),
      key: cm.attrs.id ?? "",
      resolved: cm.attrs.status === "resolved" || cm.attrs.status === "closed",
      spid: num(sp?.attrs.id),
      point: x !== undefined && y !== undefined ? { x: x / 12700, y: y / 12700 } : undefined,
      ext: extOf(cm),
      textRange: txMk ? { from: num(txMk.attrs.start) ?? 0, to: num(txMk.attrs.len) ?? 0 } : undefined,
      replies: [],
    };
    for (const r of childrenNamed(child(cm, "replyLst"), "reply")) {
      raw.replies!.push({ author: authors.get(r.attrs.authorId ?? "") ?? { name: "Unknown" }, text: paragraphsText(child(r, "txBody")), created: parseDate(r.attrs.created), key: r.attrs.id ?? "", ext: extOf(r) });
    }
    threadFrom(raw, slide, author, out);
  }
}

