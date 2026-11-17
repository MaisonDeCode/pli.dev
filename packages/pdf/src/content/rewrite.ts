/**
 * Rewriting one page's content for redaction, text replacement and picture replacement.
 *
 * What it does, in one pass over the operators (after a read-only pass that finds the runs and pictures edits name):
 *
 * - Redaction: glyphs whose box touches a rectangle are cut out of the show operators (an equal gap is left in a `TJ`
 *   so the rest of the line does not move); pictures under a rectangle are removed (fully covered) or have their
 *   covered pixels set to black in a NEW picture (see `pixels.ts`; JPEG and other codecs we cannot decode are removed
 *   whole, with a warning); painted paths are dropped (a plain rectangle that only partly overlaps is kept but
 *   clipped around the rectangle instead, so backgrounds and table lines survive); shadings are clipped around it;
 *   form XObjects that touch it are rewritten on private copies; marked-content `/ActualText` and `/Alt` are removed.
 *   Then a filled box (and optional text) is painted last. The page gets ONE new Flate content stream; the old
 *   streams, replaced pictures and replaced forms are left unreferenced, so the writer's garbage collection drops them.
 * - Text replacement: the run's glyphs are cut out the same way (no box), and the new text is drawn after the text
 *   object, on the run's baseline, in the same font when its codes can write it, else an embedded font from
 *   `SaveOptions.fonts`, else the nearest standard font (with a warning).
 * - Picture replacement: the `Do` (or inline image) is replaced by a new picture in the same box.
 */
import { decodeBase64, PliError } from "@pli.dev/core";
import { encodeFlate } from "../cos/filters";
import { PdfDict, PdfName, PdfRef, PdfStream, PdfString } from "../cos/objects";
import type { ContentOp } from "../cos/parser";
import { createPdf } from "../cos/writer";
import { embedTrueType } from "../fonts/embed";
import type { EmbeddedFont } from "../fonts/embed";
import { addStandardFont, encodeWinAnsi, measure, standardFamilyFor, winAnsiCode } from "../fonts/standard";
import { makeImageXObject } from "../image";
import type { PdfPicture, Rect } from "../model";
import type { WriteContext } from "../context";
import { lookupFont, officeSubstitute } from "@pli.dev/core";
import { blankPixels, expandInlineDict } from "./pixels";
import { Interpreter, containsRect, mul, overlaps, serializeOps, type ImageAction, type ImagePlacement, type Matrix, type PathAction, type PathInfo, type Rewriter, type Scope, type ShowAction, type ShowOp } from "./interpreter";
import { pageOps, sourceOf, type PageGeom } from "./page";
import { analyzePage, type PageAnalysis, type RawRun } from "./text";
import { parseHexColor } from "../cos/content";

export interface RedactSpec {
  rects: Rect[];
  fill?: string;
  overlay?: string;
}
export interface TextSpec {
  run: string;
  text: string;
  family?: string;
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  fit?: "none" | "shrink";
}
export interface ImageSpec {
  target: string;
  picture: PdfPicture | null;
  fit?: "contain" | "stretch";
}
export interface RewriteInput {
  redactions: RedactSpec[];
  texts: TextSpec[];
  images: ImageSpec[];
}

export interface RewriteOutcome {
  /** Text that was removed by redaction (for checking other places in the file for the same words). */
  removedText: string[];
}

// ---- fonts for new text ------------------------------------------------------------------------------------------------

export interface FontPlan {
  kind: "same" | "embedded" | "standard";
  family: string;
  bold: boolean;
  italic: boolean;
  /** Key in `SaveOptions.fonts` (kind `embedded`). */
  key?: string;
  /** Characters this choice cannot write (they come out as `?` in a standard font). */
  missing: string[];
  /** Width of the text in em. */
  widthEm: number;
  notes: string[];
}

const scratch = new WeakMap<Uint8Array, Map<string, EmbeddedFont>>();
function scratchFont(bytes: Uint8Array, family: string, bold: boolean, italic: boolean): EmbeddedFont | null {
  let per = scratch.get(bytes);
  if (!per) scratch.set(bytes, (per = new Map()));
  const k = `${bold}${italic}`;
  let f = per.get(k);
  if (!f) {
    try {
      f = embedTrueType(createPdf(), bytes, { family, bold, italic, subset: false });
    } catch {
      return null;
    }
    per.set(k, f);
  }
  return f;
}

function findFontKey(fonts: Record<string, Uint8Array> | undefined, family: string, bold: boolean, italic: boolean): string | undefined {
  if (!fonts) return undefined;
  const names = [family];
  try {
    const known = lookupFont(family)?.family;
    if (known) names.push(known);
    names.push(officeSubstitute(family));
  } catch {
    // the catalogue not knowing a name is fine
  }
  const style = `${bold ? " bold" : ""}${italic ? " italic" : ""}`;
  const keys = Object.keys(fonts);
  for (const n of names) {
    const want = (n + style).toLowerCase();
    const hit = keys.find((k) => k.toLowerCase() === want);
    if (hit) return hit;
  }
  return undefined;
}

const sameFamily = (a: string, b: string): boolean => a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();

/** Decides which font writes `text` in place of a run, without changing anything. */
export function planFont(op: ShowOp, spec: { text: string; family?: string; bold?: boolean; italic?: boolean }, fonts: Record<string, Uint8Array> | undefined, used?: ReadonlySet<number>): FontPlan {
  const text = spec.text.replace(/[\r\n\t]+/g, " ");
  const orig = op.font;
  const family = spec.family ?? orig.name.family;
  const bold = spec.bold ?? orig.name.bold;
  const italic = spec.italic ?? orig.name.italic;
  const notes: string[] = [];
  const styleSame = bold === orig.name.bold && italic === orig.name.italic;
  if ((spec.family === undefined || sameFamily(spec.family, orig.name.family)) && styleSame && !orig.type3 && !orig.vertical) {
    const enc = orig.encode(text, used);
    if (enc.missing.length === 0) return { kind: "same", family: orig.name.family, bold, italic, missing: [], widthEm: enc.width, notes };
    notes.push(`The font ${orig.name.family} has no ${describe(enc.missing)}${orig.embedded ? " (only the characters already used on the page are known to be in an embedded font)" : ""}.`);
  }
  const key = findFontKey(fonts, family, bold, italic);
  if (key) {
    const f = scratchFont(fonts![key]!, family, bold, italic);
    if (f) {
      const missing = [...new Set([...text].filter((c) => c !== " " && !f.hasGlyph(c)))];
      if (missing.length === 0) return { kind: "embedded", family, bold, italic, key, missing: [], widthEm: f.width(text, 1), notes };
      notes.push(`The font ${family} has no ${describe(missing)}.`);
    }
  } else if (fonts && Object.keys(fonts).length) notes.push(`The font ${family} was not among the fonts given for saving.`);
  else notes.push(`The font ${family} is not available for saving (pass fonts in the save options to embed it).`);
  const std = standardFamilyFor(family);
  const missing = [...new Set([...text].filter((c) => c !== " " && winAnsiCode(c) === 63 && c !== "?"))];
  notes.push(`${std} is used instead${missing.length ? `, and ${describe(missing)} cannot be written in it` : ""}.`);
  return { kind: "standard", family: std, bold, italic, missing, widthEm: measure(text, std, 1, { bold, italic }), notes };
}

const describe = (chars: string[]): string => `character${chars.length > 1 ? "s" : ""} ${chars.slice(0, 5).map((c) => `"${c}"`).join(" ")}`;

const embeddedFonts = new WeakMap<object, Map<string, EmbeddedFont>>();

/** Calls `finish()` on the fonts that were embedded for new text (after the last page). */
export function finishEmbeddedFonts(overlay: object): void {
  for (const f of embeddedFonts.get(overlay)?.values() ?? []) f.finish();
}

// ---- pictures -----------------------------------------------------------------------------------------------------------

function pictureBytes(picture: PdfPicture): { png: Uint8Array } | { jpeg: Uint8Array } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(picture.src);
  if (!m) return null;
  const bytes = m[2] ? decodeBase64(m[3]!) : new TextEncoder().encode(decodeURIComponent(m[3]!));
  if (!bytes) return null;
  const type = m[1]!.toLowerCase();
  if (type.includes("png")) return { png: bytes };
  if (type.includes("jpeg") || type.includes("jpg")) return { jpeg: bytes };
  return bytes[0] === 0x89 ? { png: bytes } : bytes[0] === 0xff ? { jpeg: bytes } : null;
}

// ---- the rewriter ----------------------------------------------------------------------------------------------------------

interface TextPlan {
  spec: TextSpec;
  raw: RawRun;
  first: ShowOp;
  fromGlyph: number;
  oldLength: number;
}

const hitGlyph = (box: Rect, r: Rect): boolean => {
  const ex = Math.min(0.5, 0.1 * box.w);
  const ey = 0.15 * box.h;
  return box.x + box.w - ex > r.x && r.x + r.w > box.x + ex && box.y + box.h - ey > r.y && r.y + r.h > box.y + ey;
};

const lum = (hex: string): number => {
  const [r, g, b] = parseHexColor(hex);
  return 0.3 * r + 0.59 * g + 0.11 * b;
};

const num = (n: number): number => Math.round(n * 100000) / 100000;

export function rewritePage(ctx: WriteContext, pageRef: PdfRef, geom: PageGeom, pageIndex: number, input: RewriteInput): RewriteOutcome {
  const overlay = ctx.overlay;
  const src = sourceOf(overlay);
  const rects = input.redactions.flatMap((r) => r.rects).filter((r) => r.w > 0 && r.h > 0);
  const ops = pageOps(src, geom, true);
  const removedText: string[] = [];
  const warned = new Set<string>();
  const warn = (m: string) => {
    if (!warned.has(m)) {
      warned.add(m);
      ctx.warnings.push(m);
    }
  };

  // Pass 1: what the edits point at.
  const needAnalysis = input.texts.length > 0 || input.images.length > 0;
  const analysis: PageAnalysis | null = needAnalysis ? analyzePage(src, geom, pageIndex) : null;
  const removeFor = new Map<string, Set<number>>();
  const afterFor = new Map<string, TextPlan[]>();
  const formPaths = new Set<string>();
  const addPrefixes = (path: string) => {
    if (!path) return;
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) formPaths.add(parts.slice(0, i).join("/"));
  };
  if (analysis) {
    const rawById = new Map(analysis.raws.map((r) => [r.id, r]));
    for (const spec of input.texts) {
      const raw = rawById.get(spec.run);
      if (!raw) {
        warn(`A text edit was skipped: the run ${spec.run} is not on the page any more.`);
        continue;
      }
      for (const piece of raw.pieces) {
        const key = piece.op.key;
        const set = removeFor.get(key) ?? new Set<number>();
        for (let i = piece.from; i < piece.to; i++) set.add(i);
        removeFor.set(key, set);
        addPrefixes(piece.op.stream);
      }
      const first = raw.pieces[0]!;
      const last = raw.pieces[raw.pieces.length - 1]!;
      const g0 = first.op.glyphs[first.from]!;
      const g1 = last.op.glyphs[last.to - 1]!;
      const oldLength = (g1.end_[0] - g0.origin[0]) * first.op.dir[0] + (g1.end_[1] - g0.origin[1]) * first.op.dir[1];
      const plan: TextPlan = { spec, raw, first: first.op, fromGlyph: first.from, oldLength };
      const list = afterFor.get(first.op.key) ?? [];
      list.push(plan);
      afterFor.set(first.op.key, list);
    }
    for (const spec of input.images) {
      const target = analysis.placements.find((p) => p.id === spec.target);
      if (!target) warn(`A picture edit was skipped: the picture ${spec.target} is not on the page any more.`);
      else addPrefixes(target.stream);
    }
  }
  const imageSpecs = new Map(input.images.map((s) => [s.target, s]));
  const usedCodes = (font: ShowOp["font"]): ReadonlySet<number> | undefined => analysis?.interpreter.used.get(font);

  let pathsDropped = 0;

  const lookupCs = (scope: Scope) => (name: string) => scope.lookup("ColorSpace", name);

  const redactImage = (img: ImagePlacement): ImageAction | undefined => {
    const hit = rects.filter((r) => overlaps(img.box, r, 0.01));
    if (!hit.length) return undefined;
    const m = img.pageMatrix;
    const quad: [number, number][] = [[m[4], m[5]], [m[0] + m[4], m[1] + m[5]], [m[0] + m[2] + m[4], m[1] + m[3] + m[5]], [m[2] + m[4], m[3] + m[5]]];
    const eps = 0.01;
    if (hit.some((r) => quad.every(([x, y]) => x >= r.x - eps && x <= r.x + r.w + eps && y >= r.y - eps && y <= r.y + r.h + eps))) {
      return { kind: "remove" };
    }
    const dict = img.inline ? expandInlineDict(src, img.dict, lookupCs(img.scope)) : img.dict;
    const data = img.inline ? img.data! : img.xobject!.data;
    const out = blankPixels(src, dict, data, img.pageMatrix, hit, lookupCs(img.scope), (s) => overlay.add(s));
    if (out.kind === "none") return undefined;
    if (out.kind === "unsupported") {
      warn(`A picture under a redaction could not be cut (${out.reason}), so the whole picture was removed.`);
      return { kind: "remove" };
    }
    const ref = overlay.add(out.stream);
    const name = img.scope.addXObject(ref);
    return { kind: "ops", ops: [{ op: "Do", args: [PdfName.of(name)] }] };
  };

  const replaceImage = (img: ImagePlacement, spec: ImageSpec): ImageAction => {
    if (spec.picture === null) return { kind: "remove" };
    const bytes = pictureBytes(spec.picture);
    if (!bytes) {
      warn("A picture was not replaced: it is not a PNG or JPEG picture, or its web address could not be fetched, so the old picture was kept.");
      return { kind: "ops", ops: img.inline ? [{ op: "BI", args: [img.dict, new PdfString(img.data!)] }] : [{ op: "Do", args: [PdfName.of(img.name)] }] };
    }
    let made;
    try {
      made = makeImageXObject(overlay, bytes);
    } catch (e) {
      warn(`A picture was not replaced: ${e instanceof PliError ? e.message : "it could not be read"}`);
      return { kind: "ops", ops: img.inline ? [{ op: "BI", args: [img.dict, new PdfString(img.data!)] }] : [{ op: "Do", args: [PdfName.of(img.name)] }] };
    }
    const name = img.scope.addXObject(made.ref);
    const out: ContentOp[] = [];
    if (spec.fit === "stretch") out.push({ op: "Do", args: [PdfName.of(name)] });
    else {
      // fit inside the old box, keeping the picture's proportions, centred
      const m = img.pageMatrix;
      const sideW = Math.hypot(m[0], m[1]) || 1;
      const sideH = Math.hypot(m[2], m[3]) || 1;
      const s = Math.min(sideW / made.width, sideH / made.height);
      const su = (made.width * s) / sideW;
      const sv = (made.height * s) / sideH;
      out.push({ op: "q", args: [] }, { op: "cm", args: [num(su), 0, 0, num(sv), num((1 - su) / 2), num((1 - sv) / 2)] }, { op: "Do", args: [PdfName.of(name)] }, { op: "Q", args: [] });
    }
    return { kind: "ops", ops: out };
  };

  const emitText = (plan: TextPlan, scope: Scope): ContentOp[] => {
    const { spec, first } = plan;
    const g = first.glyphs[plan.fromGlyph]!;
    const text = spec.text.replace(/[\r\n\t]+/g, " ");
    if (!text) return [];
    const tmGlyph: Matrix = mul([1, 0, 0, 1, g.at[0], g.at[1]], first.tm);
    const fplan = planFont(first, spec, ctx.options.fonts, usedCodes(first.font));
    for (const n of fplan.notes) warn(n);
    let resName: string;
    let bytes: Uint8Array;
    let hex = false;
    if (fplan.kind === "same") {
      resName = first.fontName;
      bytes = first.font.encode(text, usedCodes(first.font)).bytes;
      hex = first.font.composite;
    } else if (fplan.kind === "embedded") {
      let map = embeddedFonts.get(overlay);
      if (!map) embeddedFonts.set(overlay, (map = new Map()));
      const mk = `${fplan.key}`;
      let f = map.get(mk);
      if (!f) map.set(mk, (f = embedTrueType(overlay, ctx.options.fonts![fplan.key!]!, { family: fplan.family, bold: fplan.bold, italic: fplan.italic })));
      resName = scope.addFont(f.ref);
      bytes = f.encode(text);
      hex = true;
    } else {
      resName = scope.addFont(addStandardFont(overlay, fplan.family, { bold: fplan.bold, italic: fplan.italic }));
      bytes = encodeWinAnsi(text);
    }
    const scale = first.em / (Math.abs(first.size) || 1);
    const textSize = spec.size ? spec.size / scale : first.size;
    let th = first.th;
    const newLength = fplan.widthEm * Math.abs(textSize) * th * scale;
    if (newLength > plan.oldLength * 1.01 + 0.5) {
      if (spec.fit === "shrink" && newLength > 0) {
        const factor = Math.max(0.7, plan.oldLength / newLength);
        th *= factor;
        if (factor * newLength > plan.oldLength * 1.01 + 0.5) warn(`The new text is still wider than the old (${Math.round(newLength * factor)} pt against ${Math.round(plan.oldLength)} pt) after narrowing it as far as allowed.`);
      } else warn(`The new text is wider than the old (${Math.round(newLength)} pt against ${Math.round(plan.oldLength)} pt) and may run into what follows it.`);
    }
    const out: ContentOp[] = [{ op: "q", args: [] }];
    if (spec.color) out.push({ op: "rg", args: [...parseHexColor(spec.color).map(num)] });
    else out.push(...first.fill.ops);
    out.push(
      { op: "cm", args: tmGlyph.map(num) },
      { op: "BT", args: [] },
      { op: "Tf", args: [PdfName.of(resName), num(textSize)] },
      { op: "Tc", args: [0] },
      { op: "Tw", args: [0] },
      { op: "Tz", args: [num(th * 100)] },
      { op: "Ts", args: [num(first.rise)] },
      { op: "Tr", args: [0] },
      { op: "Td", args: [0, 0] },
      { op: "Tj", args: [new PdfString(bytes, hex)] },
      { op: "ET", args: [] },
      { op: "Q", args: [] },
    );
    return out;
  };

  const rewriter: Rewriter = {
    stripMarkedText: rects.length > 0,
    show(op: ShowOp): ShowAction | undefined {
      const remove = new Set<number>(removeFor.get(op.key) ?? []);
      if (rects.length) {
        let run = "";
        for (const g of op.glyphs) {
          if (rects.some((r) => hitGlyph(g.box, r))) {
            remove.add(g.index);
            run += g.unicode;
          } else if (run) {
            removedText.push(run);
            run = "";
          }
        }
        if (run) removedText.push(run);
      }
      const plans = afterFor.get(op.key);
      if (!remove.size && !plans) return undefined;
      return { remove, ...(plans ? { after: (scope: Scope) => plans.flatMap((p) => emitText(p, scope)) } : {}) };
    },
    image(img) {
      const spec = imageSpecs.get(img.id);
      if (spec) return replaceImage(img, spec);
      if (rects.length) return redactImage(img);
      return undefined;
    },
    path(info: PathInfo): PathAction | undefined {
      if (!rects.length) return undefined;
      const drop = new Set<number>();
      const clipOut = new Set<Rect>();
      let any = false;
      info.parts.forEach((p, i) => {
        const grow = info.stroke ? info.lineWidth / 2 : 0;
        const bb: Rect = { x: p.bbox.x - grow, y: p.bbox.y - grow, w: p.bbox.w + 2 * grow, h: p.bbox.h + 2 * grow };
        const hits = rects.filter((r) => overlaps(bb, r, 0.01));
        if (!hits.length) return;
        any = true;
        if (info.clip) return;
        if (hits.some((r) => containsRect(r, bb, 0.01))) {
          drop.add(i);
          return;
        }
        if (p.rect) hits.forEach((h) => clipOut.add(h));
        else {
          drop.add(i);
          pathsDropped++;
        }
      });
      if (!any) return undefined;
      if (info.clip) return { noPaint: true };
      return { drop, ...(clipOut.size ? { clipOut: [...clipOut] } : {}) };
    },
    shading: () => (rects.length ? rects : undefined),
    form: ({ path, box }) => formPaths.has(path) || box === null || rects.some((r) => overlaps(box, r, 0.01)),
    writeForm(original: PdfStream, newOps: ContentOp[], resources: PdfDict | null): PdfRef {
      const d = original.dict.clone();
      for (const k of ["Length", "Filter", "DecodeParms", "Metadata", "PieceInfo"]) d.delete(k);
      if (resources) d.set("Resources", resources);
      d.set("Filter", PdfName.of("FlateDecode"));
      return overlay.add(new PdfStream(d, encodeFlate(serializeOps(newOps))));
    },
  };

  // Pass 2: the rewrite.
  const interp = new Interpreter(src, geom.base, rewriter, { width: geom.width, height: geom.height });
  const res = interp.runPage(ops, geom.resources);
  let content: ContentOp[] = res.ops;

  if (input.redactions.length) {
    const boxes: ContentOp[] = [];
    for (const spec of input.redactions) {
      const fill = spec.fill ?? "#000000";
      const [r, g, b] = parseHexColor(fill);
      for (const rect of spec.rects) {
        if (rect.w <= 0 || rect.h <= 0) continue;
        const x = rect.x + geom.box[0];
        const y = geom.box[3] - rect.y - rect.h;
        boxes.push({ op: "q", args: [] }, { op: "rg", args: [num(r), num(g), num(b)] }, { op: "re", args: [num(x), num(y), num(rect.w), num(rect.h)] }, { op: "f", args: [] });
        if (spec.overlay) {
          const fontRef = addStandardFont(overlay, "Helvetica", { bold: false });
          const name = res.scope.addFont(fontRef);
          const text = spec.overlay.replace(/[\r\n\t]+/g, " ");
          let size = Math.min(rect.h * 0.7, 14);
          const width = measure(text, "Helvetica", size);
          if (width > rect.w * 0.95) size = Math.max(3, (size * rect.w * 0.95) / width);
          const w = measure(text, "Helvetica", size);
          const gray = lum(fill) > 0.5 ? 0 : 1;
          boxes.push(
            { op: "g", args: [gray] },
            { op: "BT", args: [] },
            { op: "Tf", args: [PdfName.of(name), num(size)] },
            { op: "Td", args: [num(x + Math.max(0, (rect.w - w) / 2)), num(y + (rect.h - size * 0.7) / 2)] },
            { op: "Tj", args: [new PdfString(encodeWinAnsi(text))] },
            { op: "ET", args: [] },
          );
        }
        boxes.push({ op: "Q", args: [] });
      }
    }
    const closers: ContentOp[] = [];
    for (let i = 0; i < res.depth + 1; i++) closers.push({ op: "Q", args: [] });
    content = [{ op: "q", args: [] }, ...content, ...closers, ...boxes];
  }

  const data = encodeFlate(serializeOps(content));
  const stream = overlay.add(new PdfStream(new PdfDict({ Filter: PdfName.of("FlateDecode") }), data));
  const page = overlay.edit<PdfDict>(pageRef);
  page.set("Contents", stream);
  const newResources = res.scope.finish();
  if (newResources) page.set("Resources", newResources);
  if (rects.length) for (const k of ["Thumb", "PieceInfo", "Metadata"]) page.delete(k);
  if (pathsDropped) warn(`${pathsDropped} drawn shape${pathsDropped === 1 ? "" : "s"} (lines or curves) touching a redaction ${pathsDropped === 1 ? "was" : "were"} removed whole, not cut.`);
  return { removedText };
}
