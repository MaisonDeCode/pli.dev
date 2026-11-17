/**
 * JSON annotations to PDF annotations: what changed since the file was read is written as real annotation
 * dictionaries with appearance streams, in place where the annotation came from the file. Comment threads are written
 * as the annotation's `/Contents` and `/IRT` reply annotations. `flattenAnnotations` draws the appearances into the pages.
 */
import type { Comment, Thread } from "@pli.dev/core";
import type { WriteContext } from "../context";
import { ContentBuilder, ResourceNames } from "../cos/content";
import { PdfDict, PdfName, PdfRef, PdfStream, PdfString, isArray, isDict, isRef, isStream, latin1Bytes, pdfText, type PdfObj } from "../cos/objects";
import { cloneDirect, type Overlay } from "../cos/overlay";
import { inheritedPageAttr } from "../cos/pagetree";
import { standardFamilyFor } from "../fonts/standard";
import type { Annotation, LineEnd, PdfAnchor, PdfDoc, PdfPicture, Page, StrokeStyle } from "../model";
import { pdfDate } from "../saver";
import { buildAppearance, drawState, emptyAppearance, finishState, type DrawState } from "./appearance";
import { rectToPdf, type Box } from "./geometry";
import { PLI_AUTHOR, PLI_BORDER, PLI_SIGNATURE, PLI_STAMP } from "./keys";
import { READ_SUBTYPES, readAnnotation, type ReadEnv } from "./read";
import { sanitize } from "./sanitize";
import { canonical, colorArray, nameOf, numbers } from "./util";

// ---- Pages --------------------------------------------------------------------------------------------------------

/** The page object of a page id: set by `applyPages` in `ctx.pageRefs`, else the page of the original file it came from. */
export function pageRefOf(ctx: WriteContext, pageId: string): PdfRef | undefined {
  const known = ctx.pageRefs.get(pageId);
  if (known) return known;
  const page = ctx.doc.pages.find((p) => p.id === pageId) ?? ctx.baseline.pages.find((p) => p.id === pageId);
  if (page?.from && page.from.source === "main" && ctx.main) return ctx.main.pages()[page.from.index]?.ref;
  return undefined;
}

const rectArray = (src: Overlay, o: PdfObj | undefined): [number, number, number, number] | undefined => {
  const n = numbers(src, o);
  if (!n || n.length < 4) return undefined;
  return [Math.min(n[0]!, n[2]!), Math.min(n[1]!, n[3]!), Math.max(n[0]!, n[2]!), Math.max(n[1]!, n[3]!)];
};

/** The visible box of a page object: its CropBox within its MediaBox (inherited entries included). */
export function pageBox(o: Overlay, page: PdfDict): Box {
  let media = rectArray(o, inheritedPageAttr(o, page, "MediaBox"));
  if (!media || media[2] - media[0] <= 0 || media[3] - media[1] <= 0) media = [0, 0, 612, 792];
  let crop = rectArray(o, inheritedPageAttr(o, page, "CropBox"));
  if (crop) {
    crop = [Math.max(crop[0], media[0]), Math.max(crop[1], media[1]), Math.min(crop[2], media[2]), Math.min(crop[3], media[3])];
    if (crop[2] - crop[0] <= 0 || crop[3] - crop[1] <= 0) crop = undefined;
  }
  return crop ?? media;
}

const refKey = (o: PdfObj | undefined): string | undefined => (isRef(o) ? o.key : undefined);
const parseRef = (key: string | undefined): PdfRef | undefined => {
  const m = key ? /^(\d+) (\d+)$/.exec(key) : null;
  return m ? new PdfRef(+m[1]!, +m[2]!) : undefined;
};
const N = PdfName.of;
const round = (v: number): number => Math.round(v * 1e4) / 1e4;

// ---- Dictionaries -------------------------------------------------------------------------------------------------

const SUBTYPE: Record<Annotation["type"], string> = {
  highlight: "Highlight",
  underline: "Underline",
  strikeout: "StrikeOut",
  squiggly: "Squiggly",
  ink: "Ink",
  square: "Square",
  circle: "Circle",
  line: "Line",
  polygon: "Polygon",
  polyline: "PolyLine",
  freetext: "FreeText",
  note: "Text",
  stamp: "Stamp",
  signature: "Stamp",
  image: "Stamp",
  link: "Link",
  redact: "Redact",
};

/** The entries Pli writes: they are removed from an existing dictionary before it is filled in again. Everything else (`/Popup`, `/StructParent`, private entries of other tools) stays. */
const OWNED = [
  "Subtype", "Rect", "F", "NM", "T", "M", "CreationDate", "Contents", "C", "CA", "AP", "AS", "P", "QuadPoints", "InkList", "BS", "Border", "BE", "BEI", "IC", "RD", "L", "LE", "LL", "LLE", "LLO", "CP", "CL",
  "Vertices", "DA", "DS", "RC", "Q", "Name", "Open", "A", "AA", "Dest", "H", "OverlayText", "Repeat", "State", "StateModel", "IT", "Subj", "Cap", "Measure", PLI_AUTHOR, PLI_BORDER, PLI_STAMP, PLI_SIGNATURE,
];

const END_NAMES: Record<LineEnd, string> = { none: "None", arrow: "ClosedArrow", "open-arrow": "OpenArrow", "closed-arrow": "ClosedArrow", circle: "Circle", square: "Square", diamond: "Diamond", butt: "Butt", slash: "Slash" };
const ICON_NAMES = { comment: "Comment", note: "Note", help: "Help", insert: "Insert", key: "Key", paragraph: "Paragraph" } as const;
const DA_FONT: Record<string, [string, string, string, string]> = { Helvetica: ["Helv", "HeBo", "HeOb", "HeBO"], Times: ["TiRo", "TiBo", "TiIt", "TiBI"], Courier: ["Cour", "CoBo", "CoOb", "CoBO"] };

function borderStyle(s: StrokeStyle): PdfDict {
  const d = new PdfDict({ Type: N("Border"), W: round(s.width), S: N(s.dash && s.dash.length > 0 ? "D" : "S") });
  if (s.dash && s.dash.length > 0) d.set("D", s.dash.map(round));
  return d;
}

const flat = (pts: readonly (readonly [number, number])[], box: Box): number[] => pts.flatMap((p) => [round(box[0] + p[0]), round(box[3] - p[1])]);

export const pictureOf = (a: Annotation): PdfPicture | undefined => {
  if (a.type === "image") return a.picture;
  if (a.type === "signature") return a.picture;
  if (a.type === "stamp" && "picture" in a.stamp) return a.stamp.picture;
  return undefined;
};

function uriString(uri: string): PdfString {
  const ascii = /^[\x20-\x7e]*$/.test(uri) ? uri : encodeURI(uri);
  return new PdfString(latin1Bytes(ascii));
}

interface DictInput {
  box: Box;
  pageRef: PdfRef;
  now: number;
  /** The text readers show: the thread's first comment when there is a thread. */
  contents: string | undefined;
  resolved: boolean;
  ap: PdfRef | undefined;
  rect: [number, number, number, number];
  destination?: PdfRef;
}

function fillDict(d: PdfDict, a: Annotation, i: DictInput): void {
  for (const k of OWNED) d.delete(k);
  d.set("Type", N("Annot"));
  d.set("Subtype", N(SUBTYPE[a.type]));
  d.set("Rect", i.rect.map(round));
  d.set("F", 4 + (a.hidden ? 2 : 0) + (a.locked ? 128 : 0));
  d.set("NM", pdfText(a.id));
  d.set("P", i.pageRef);
  if (a.authorName) d.set("T", pdfText(a.authorName));
  if (a.author) d.set(PLI_AUTHOR, pdfText(a.author));
  d.set("M", pdfText(pdfDate(a.modified ?? i.now)));
  if (a.created !== undefined) d.set("CreationDate", pdfText(pdfDate(a.created)));
  if (a.opacity !== undefined && a.opacity < 1) d.set("CA", round(a.opacity));
  if (i.ap) d.set("AP", new PdfDict({ N: i.ap }));
  if (i.resolved) {
    d.set("StateModel", pdfText("Review"));
    d.set("State", pdfText("Completed"));
  }
  const box = i.box;
  let contents = i.contents;
  switch (a.type) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
      d.set("C", colorArray(a.color));
      d.set("QuadPoints", a.rects.flatMap((r) => [round(box[0] + r.x), round(box[3] - r.y), round(box[0] + r.x + r.w), round(box[3] - r.y), round(box[0] + r.x), round(box[3] - r.y - r.h), round(box[0] + r.x + r.w), round(box[3] - r.y - r.h)]));
      break;
    case "redact":
      d.set("QuadPoints", a.rects.flatMap((r) => [round(box[0] + r.x), round(box[3] - r.y), round(box[0] + r.x + r.w), round(box[3] - r.y), round(box[0] + r.x), round(box[3] - r.y - r.h), round(box[0] + r.x + r.w), round(box[3] - r.y - r.h)]));
      d.set("IC", colorArray(a.fill ?? "#000000"));
      d.set("C", [1, 0, 0]);
      if (a.overlay) d.set("OverlayText", pdfText(a.overlay));
      break;
    case "ink":
      d.set("C", colorArray(a.stroke.color));
      d.set("BS", borderStyle(a.stroke));
      d.set("InkList", a.strokes.map((s) => flat(s, box)));
      break;
    case "square":
    case "circle":
      d.set("C", colorArray(a.stroke.color));
      d.set("BS", borderStyle(a.stroke));
      if (a.fill) d.set("IC", colorArray(a.fill));
      d.set("RD", Array<number>(4).fill(round(a.stroke.width / 2)));
      break;
    case "line":
      d.set("C", colorArray(a.stroke.color));
      d.set("BS", borderStyle(a.stroke));
      d.set("L", flat([a.from, a.to], box));
      d.set("LE", [N(END_NAMES[a.startEnd ?? "none"]), N(END_NAMES[a.endEnd ?? "none"])]);
      break;
    case "polygon":
    case "polyline":
      d.set("C", colorArray(a.stroke.color));
      d.set("BS", borderStyle(a.stroke));
      if (a.fill) d.set("IC", colorArray(a.fill));
      d.set("Vertices", flat(a.points, box));
      break;
    case "freetext": {
      const { style } = a;
      const fam = standardFamilyFor(style.family);
      const abbr = DA_FONT[fam]![(style.bold ? 1 : 0) + (style.italic ? 2 : 0)]!;
      d.set("DA", pdfText(`${colorArray(style.color).join(" ")} rg /${abbr} ${round(style.size)} Tf`));
      d.set("DS", pdfText(`font: ${style.bold ? "bold " : ""}${style.italic ? "italic " : ""}${style.family} ${round(style.size)}pt; text-align:${style.align ?? "left"}; color:${style.color}`));
      d.set("Q", style.align === "center" ? 1 : style.align === "right" ? 2 : 0);
      if (a.fill) d.set("C", colorArray(a.fill));
      d.set("BS", borderStyle({ color: a.stroke?.color ?? "#000000", width: a.stroke?.width ?? 0, dash: a.stroke?.dash }));
      if (a.stroke) d.set(PLI_BORDER, pdfText(a.stroke.color));
      d.set("IT", N("FreeText"));
      contents = a.text;
      break;
    }
    case "note":
      d.set("Name", N(ICON_NAMES[a.icon ?? "note"]));
      if (a.color) d.set("C", colorArray(a.color));
      d.set("Open", !!a.open);
      break;
    case "stamp": {
      if ("picture" in a.stamp) d.set("Name", N("PliPicture"));
      else {
        d.set("Name", N(a.stamp.name));
        if (a.stamp.color) d.set("C", colorArray(a.stamp.color));
        if (a.stamp.label || a.stamp.color) {
          const s = new PdfDict();
          if (a.stamp.label) s.set("Label", pdfText(a.stamp.label));
          if (a.stamp.color) s.set("Color", pdfText(a.stamp.color));
          d.set(PLI_STAMP, s);
        }
      }
      break;
    }
    case "image":
      d.set("Name", N("ImageAnnot"));
      break;
    case "signature": {
      d.set("Name", N("PliSignature"));
      const s = new PdfDict({ Mode: N(a.mode) });
      if (a.strokes) s.set("Strokes", a.strokes.map((st) => st.flatMap((p) => [round(p[0]), round(p[1])])));
      if (a.text !== undefined) s.set("Text", pdfText(a.text));
      if (a.font) s.set("Font", pdfText(a.font));
      if (a.color) s.set("Color", pdfText(a.color));
      if (a.width !== undefined) s.set("W", a.width);
      if (a.field) s.set("Field", pdfText(a.field));
      d.set(PLI_SIGNATURE, s);
      break;
    }
    case "link":
      d.set("Border", [0, 0, 0]);
      if (a.uri) d.set("A", new PdfDict({ S: N("URI"), URI: uriString(a.uri) }));
      else if (a.dest && i.destination) d.set("Dest", [i.destination, N("XYZ"), null, a.dest.y === undefined ? null : round(box[3] - a.dest.y), null]);
      break;
  }
  if (contents) d.set("Contents", pdfText(contents));
}

// ---- Threads ------------------------------------------------------------------------------------------------------

const threadOf = (doc: PdfDoc, a: Annotation): Thread<PdfAnchor> | undefined => (a.thread ? doc.comments?.[a.thread] : undefined);

/** Names for user ids, from what the document itself knows (annotations and replies carry both). */
function authorNames(doc: PdfDoc, extra: Record<string, string> | undefined): (id: string) => string {
  const names = new Map<string, string>(Object.entries(extra ?? {}));
  for (const p of doc.pages)
    for (const a of p.annots) {
      if (a.author && a.authorName && !names.has(a.author)) names.set(a.author, a.authorName);
      for (const r of a.replies ?? []) if (r.author && r.authorName && !names.has(r.author)) names.set(r.author, r.authorName);
    }
  return (id) => names.get(id) ?? id;
}

function writeReply(o: Overlay, st: DrawState, existing: PdfRef | undefined, c: Comment, root: { ref: PdfRef; rect: number[]; pageRef: PdfRef }, name: (id: string) => string, now: number): PdfRef {
  const d = existing ? o.edit<PdfDict>(existing) : new PdfDict();
  const ref = existing ?? o.add(d);
  for (const k of ["Subtype", "Rect", "F", "NM", "T", "M", "CreationDate", "Contents", "P", "IRT", "RT", "Name", "AP", PLI_AUTHOR]) d.delete(k);
  d.set("Type", N("Annot"));
  d.set("Subtype", N("Text"));
  const x = root.rect[0]!;
  const y = root.rect[1]!;
  d.set("Rect", [x, y, x + 1, y + 1].map(round));
  d.set("F", 4);
  d.set("NM", pdfText(c.id));
  d.set("P", root.pageRef);
  d.set("IRT", root.ref);
  d.set("RT", N("R"));
  d.set("Name", N("Comment"));
  d.set("T", pdfText(name(c.author)));
  d.set(PLI_AUTHOR, pdfText(c.author));
  d.set("Contents", pdfText(c.body));
  d.set("CreationDate", pdfText(pdfDate(c.createdAt)));
  d.set("M", pdfText(pdfDate(c.editedAt ?? c.createdAt ?? now)));
  d.set("AP", new PdfDict({ N: emptyAppearance(st) }));
  return ref;
}

// ---- A page -------------------------------------------------------------------------------------------------------

function imageRefIn(o: Overlay, dict: PdfDict | undefined): PdfRef | undefined {
  if (!dict) return undefined;
  const ap = o.get(dict.get("AP"));
  const n = isDict(ap) ? o.get(ap.get("N")) : null;
  const res = isStream(n) ? o.get(n.dict.get("Resources")) : null;
  const xo = isDict(res) ? o.get(res.get("XObject")) : null;
  if (!isDict(xo)) return undefined;
  for (const v of xo.map.values()) if (isRef(v) && isStream(o.get(v)) && nameOf(o, (o.get(v) as PdfStream).dict.get("Subtype")) === "Image") return v;
  return undefined;
}

const isOwnedEntry = (o: Overlay, e: PdfObj): boolean => {
  const d = isRef(e) ? o.get(e) : null;
  if (!isDict(d)) return false;
  const sub = nameOf(o, d.get("Subtype"));
  return !!sub && (READ_SUBTYPES.has(sub) || sub === "Popup");
};

function writePage(ctx: WriteContext, st: DrawState, page: Page, base: Page | undefined, pageRef: PdfRef, name: (id: string) => string): void {
  const o = ctx.overlay;
  const pd = o.get(pageRef);
  if (!isDict(pd)) return;
  const box = pageBox(o, pd);
  const arr = o.get(pd.get("Annots"));
  const orig: PdfObj[] = isArray(arr) ? arr : [];
  const baseAnnots = base?.annots ?? [];
  const baseById = new Map(baseAnnots.map((a) => [a.id, a]));
  const docIds = new Set(page.annots.map((a) => a.id));

  // Objects that belong to annotations Pli reads: replaced where they stand, or removed with their annotation.
  const dead = new Set<string>();
  const ownedKeys = new Set<string>(baseAnnots.flatMap((a) => (a.ref ? [a.ref] : [])));
  const attached = new Map<string, string[]>(); // root key -> keys of popup, replies, state annotations
  const rootKeyOf = (e: PdfRef): string | undefined => {
    let cur: PdfObj | undefined = e;
    for (let hops = 0; hops < 16 && isRef(cur); hops++) {
      const d = o.get(cur);
      if (!isDict(d)) return undefined;
      if (!d.has("IRT")) return cur.key;
      cur = d.get("IRT");
    }
    return undefined;
  };
  for (const e of orig) {
    if (!isRef(e)) continue;
    const d = o.get(e);
    if (!isDict(d)) continue;
    const sub = nameOf(o, d.get("Subtype"));
    let root: string | undefined;
    if (sub === "Popup") root = refKey(d.get("Parent"));
    else if (d.has("IRT") && sub === "Text") root = rootKeyOf(e);
    if (root && ownedKeys.has(root)) (attached.get(root) ?? attached.set(root, []).get(root)!).push(e.key);
  }

  const freshPage = !base;
  if (freshPage && (page.annots.length > 0 || !page.from)) for (const e of orig) if (isRef(e) && isOwnedEntry(o, e)) dead.add(e.key);

  const kill = (key: string): void => {
    dead.add(key);
    const r = parseRef(key);
    if (r && o.has(r)) o.remove(r);
  };

  // Removed annotations.
  for (const b of baseAnnots) {
    if (docIds.has(b.id) || !b.ref) continue;
    kill(b.ref);
    for (const k of attached.get(b.ref) ?? []) kill(k);
  }

  const order: PdfRef[] = [];
  const newReplies: PdfRef[] = [];
  for (const original of page.annots) {
    const b = baseById.get(original.id);
    const th = threadOf(ctx.doc, original);
    let a = original;
    let ref = b?.ref ? parseRef(b.ref) : undefined;
    if (ref && !isDict(o.get(ref))) ref = undefined;
    const bth = b ? threadOf(ctx.baseline, b) : undefined;
    if (b && ref && canonical({ a, th }) === canonical({ a: b, th: bth })) {
      order.push(ref);
      continue;
    }
    try {
      a = sanitize(original);
      // A picture that did not change keeps its image in the file.
      const pic = pictureOf(a);
      if (pic && b && ref && pictureOf(b)?.src === pic.src && !st.images.has(pic.src)) {
        const image = imageRefIn(o, o.get(ref) as PdfDict);
        const idict = image ? (o.get(image) as PdfStream).dict : undefined;
        const w = idict ? (o.get(idict.get("Width")) as number) : 0;
        const h = idict ? (o.get(idict.get("Height")) as number) : 0;
        if (image && w > 0 && h > 0) st.images.set(pic.src, { ref: image, width: w, height: h, alpha: false });
      }
      const built = buildAppearance(st, box, a);
      const d = ref ? o.edit<PdfDict>(ref) : new PdfDict();
      const root: PdfRef = ref ?? o.add(d);
      const apRef = built ? o.add(built.stream) : undefined;
      const rect = built?.rect ?? rectToPdf(box, a.type === "link" ? a.rect : { x: 0, y: 0, w: 1, h: 1 });
      let destination: PdfRef | undefined;
      if (a.type === "link" && a.dest) {
        destination = pageRefOf(ctx, a.dest.page);
        if (!destination && !a.uri) ctx.warnings.push(`A link points to page ${a.dest.page}, which is not in the document: it was saved without a destination.`);
      }
      const first = th?.comments[0];
      fillDict(d, a, { box, pageRef, now: ctx.now, contents: first ? first.body : bth ? undefined : a.contents, resolved: th ? !!th.resolved : !!a.resolved, ap: apRef, rect, destination });
      order.push(root);
      // Replies: a thread kept in the document is what is written; replies read from the file stay as they are.
      if (th) {
        const have = new Map((b?.replies ?? []).map((r) => [r.id, r] as const));
        const want = th.comments.slice(1);
        const wantIds = new Set(want.map((c) => c.id));
        for (const r of b?.replies ?? []) if (r.ref && !wantIds.has(r.id)) kill(r.ref);
        for (const c of want) {
          const old = have.get(c.id);
          const oldRef = old?.ref ? parseRef(old.ref) : undefined;
          const same = old && oldRef && old.body === c.body && (old.author ?? old.authorName ?? "") === (c.author || "") && (old.created ?? b?.created ?? 0) === c.createdAt;
          if (same) continue;
          const written = writeReply(o, st, oldRef && o.has(oldRef) ? oldRef : undefined, c, { ref: root, rect, pageRef }, name, ctx.now);
          if (!oldRef) newReplies.push(written);
        }
      }
      // A thread that was deleted takes its replies with it.
      if (!th && bth) for (const r of b?.replies ?? []) if (r.ref) kill(r.ref);
      // A review state kept as a separate annotation is replaced by the one on the annotation itself.
      const was = bth ? !!bth.resolved : !!b?.resolved;
      const now = th ? !!th.resolved : !!a.resolved;
      if (b?.ref && was !== now) {
        for (const k of attached.get(b.ref) ?? []) {
          const r = parseRef(k);
          const dd = r ? o.get(r) : null;
          if (isDict(dd) && dd.has("State")) kill(k);
        }
      }
    } catch (error) {
      ctx.warnings.push(`The ${a.type} annotation ${a.id} could not be written: ${(error as Error).message}`);
    }
  }

  // /Annots: unrelated entries stay where they are; the annotations fill the places the old ones had, in the order they have now.
  const queue = [...order];
  const out: PdfObj[] = [];
  for (const e of orig) {
    const key = refKey(e);
    if (key && dead.has(key)) continue;
    if (key && ownedKeys.has(key)) {
      const next = queue.shift();
      if (next) out.push(next);
      continue;
    }
    out.push(e);
  }
  out.push(...queue, ...newReplies);
  const same = out.length === orig.length && out.every((e, i) => e === orig[i] || (refKey(e) !== undefined && refKey(e) === refKey(orig[i])));
  if (same) return;
  const edited = o.edit<PdfDict>(pageRef);
  const current = edited.get("Annots");
  if (isRef(current) && isArray(o.get(current))) {
    const target = o.edit<PdfObj[]>(current);
    target.splice(0, target.length, ...out);
  } else if (out.length > 0) edited.set("Annots", out);
  else edited.delete("Annots");
}

/** Writes what changed in the annotations (and comment threads) of every page since the file was read. */
export function writeAnnotations(ctx: WriteContext): void {
  const st = drawState(ctx);
  const extra = (ctx.options as { authorNames?: Record<string, string> }).authorNames;
  const name = authorNames(ctx.doc, extra);
  const baseById = new Map(ctx.baseline.pages.map((p) => [p.id, p]));
  const kept = new Set<string>();
  for (const page of ctx.doc.pages) {
    const base = baseById.get(page.id);
    if (base && base.annots === page.annots && ctx.doc.comments === ctx.baseline.comments) continue;
    const pageRef = pageRefOf(ctx, page.id);
    if (!pageRef) {
      if (page.annots.length > 0) ctx.warnings.push(`The annotations of page ${page.id} could not be saved: the page is not in the file.`);
      continue;
    }
    try {
      writePage(ctx, st, page, base, pageRef, name);
    } catch (error) {
      ctx.warnings.push(`The annotations of page ${page.id} could not be saved: ${(error as Error).message}`);
    }
  }
  for (const page of ctx.doc.pages) for (const a of page.annots) if (a.thread) kept.add(a.thread);
  for (const id of Object.keys(ctx.doc.comments ?? {})) if (!kept.has(id) && !ctx.baseline.comments?.[id]) ctx.warnings.push(`The comment thread ${id} belongs to no annotation on a page, so it is not saved in the file.`);
  finishState(st);
}

// ---- Flatten ------------------------------------------------------------------------------------------------------

type Matrix = [number, number, number, number, number, number];

/** The matrix `A` that places an appearance stream in the annotation's rectangle (ISO 32000-1, 12.5.5, algorithm 8.1): concatenate it, then paint the form (which applies its own Matrix first). */
export function appearanceMatrix(o: Overlay, form: PdfStream, rect: [number, number, number, number]): Matrix {
  const bbox = rectArray(o, form.dict.get("BBox")) ?? [0, 0, rect[2] - rect[0], rect[3] - rect[1]];
  const mm = numbers(o, form.dict.get("Matrix"));
  const m: Matrix = mm && mm.length >= 6 ? (mm.slice(0, 6) as Matrix) : [1, 0, 0, 1, 0, 0];
  const corners: [number, number][] = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]];
  const xs = corners.map(([x, y]) => m[0] * x + m[2] * y + m[4]);
  const ys = corners.map(([x, y]) => m[1] * x + m[3] * y + m[5]);
  const tx0 = Math.min(...xs);
  const ty0 = Math.min(...ys);
  const tw = Math.max(...xs) - tx0;
  const th2 = Math.max(...ys) - ty0;
  const sx = tw > 0 ? (rect[2] - rect[0]) / tw : 1;
  const sy = th2 > 0 ? (rect[3] - rect[1]) / th2 : 1;
  const a: Matrix = [sx, 0, 0, sy, rect[0] - tx0 * sx, rect[1] - ty0 * sy];
  // `Do` applies the form's own Matrix, so the matrix to concatenate is A alone.
  return a;
}

function appearanceOf(o: Overlay, d: PdfDict): PdfRef | undefined {
  const ap = o.get(d.get("AP"));
  if (!isDict(ap)) return undefined;
  const n = ap.get("N");
  if (isRef(n) && isStream(o.get(n))) return n;
  const states = o.get(n);
  if (isDict(states)) {
    const as = nameOf(o, d.get("AS"));
    const pick = as ? states.get(as) : undefined;
    if (isRef(pick) && isStream(o.get(pick))) return pick;
  }
  return undefined;
}

/** Draws every annotation into its page (its appearance stream becomes a form XObject painted after the page's content) and removes it. Links and form widgets stay. */
export function flattenAnnotations(ctx: WriteContext): void {
  const o = ctx.overlay;
  const st = drawState(ctx);
  let left = 0;
  for (const page of ctx.doc.pages) {
    const pageRef = pageRefOf(ctx, page.id);
    if (!pageRef) continue;
    const pd = o.get(pageRef);
    if (!isDict(pd)) continue;
    const arr = o.get(pd.get("Annots"));
    if (!isArray(arr) || arr.length === 0) continue;
    const box = pageBox(o, pd);
    const keep: PdfObj[] = [];
    const draws: { ref: PdfRef; matrix: Matrix }[] = [];
    const drop: PdfRef[] = [];
    for (const e of arr) {
      const d = isRef(e) ? o.get(e) : e;
      if (!isDict(d)) {
        keep.push(e);
        continue;
      }
      const sub = nameOf(o, d.get("Subtype"));
      if (sub === "Link" || sub === "Widget") {
        keep.push(e);
        continue;
      }
      const pushed = isRef(e);
      if (isRef(e)) drop.push(e);
      if (sub === "Popup" || (sub === "Text" && d.has("IRT"))) continue;
      const flags = (o.get(d.get("F")) as number) || 0;
      if (flags & (2 | 32)) continue;
      const rect = rectArray(o, d.get("Rect"));
      if (!rect) continue;
      let ap = appearanceOf(o, d);
      if (!ap && isRef(e)) {
        try {
          const env: ReadEnv = { src: o, decode: () => new Uint8Array(0), sourceId: "x", box };
          const a = readAnnotation(env, e, d);
          const built = a ? buildAppearance(st, box, a) : undefined;
          if (built) {
            ap = o.add(built.stream);
            rect.splice(0, 4, ...built.rect);
          }
        } catch {
          ap = undefined;
        }
      }
      if (!ap) {
        // Nothing to draw it with: it stays in the file.
        if (pushed) drop.pop();
        keep.push(e);
        left++;
        continue;
      }
      draws.push({ ref: ap, matrix: appearanceMatrix(o, o.get(ap) as PdfStream, rect) });
    }
    if (draws.length === 0 && drop.length === 0) continue;
    const edited = o.edit<PdfDict>(pageRef);
    if (draws.length > 0) {
      const inherited = inheritedPageAttr(o, edited, "Resources");
      const resolved = o.get(inherited);
      const resources = isDict(resolved) ? cloneDirect(resolved) : new PdfDict();
      const names = new ResourceNames(resources);
      const c = new ContentBuilder();
      for (const dr of draws) {
        const name = names.xobject(dr.ref);
        c.save().transform(...dr.matrix).doXObject(name).restore();
      }
      const wrapOpen = o.add(new ContentBuilder().save().toStream());
      const wrapClose = o.add(new ContentBuilder().restore().toStream());
      const mine = o.add(c.toStream());
      const contents = o.get(edited.get("Contents"));
      const parts: PdfObj[] = isArray(contents) ? [...contents] : isRef(edited.get("Contents")) && isStream(contents) ? [edited.get("Contents")!] : [];
      edited.set("Resources", resources);
      edited.set("Contents", [wrapOpen, ...parts, wrapClose, mine]);
    }
    for (const r of drop) if (o.has(r)) o.remove(r);
    if (keep.length > 0) edited.set("Annots", keep);
    else edited.delete("Annots");
  }
  finishState(st);
  if (left > 0) ctx.warnings.push(`${left} annotation${left === 1 ? " has" : "s have"} no appearance, so ${left === 1 ? "it" : "they"} could not be flattened and stayed in the file.`);
}
