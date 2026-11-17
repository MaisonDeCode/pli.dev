/**
 * The content stream interpreter: walks the operators of a page (its `/Contents` streams, form XObjects through `Do`,
 * inline images) with the parts of the graphics state that decide where things are, and reports
 *
 * - every `show` of text, with a box for each glyph in page space (unrotated, y down, origin at the top left of the
 *   crop box: the space of `model.ts`),
 * - every picture (image XObject or inline image) with its box,
 * - and, when a `Rewriter` is given, lets it change the operators on the way: glyphs taken out of text (the rest of
 *   the line stays where it was), pictures taken out or replaced, paths dropped or clipped, form XObjects rewritten
 *   on private copies. The output is the new operator list.
 *
 * Operators are named by their index in their stream (and the path of form names to it), so an id made from the name
 * is the same every time the same bytes are read, whether or not forms are entered.
 *
 * Not tracked, on purpose: clipping paths (text and pictures that are clipped away are still reported), blend modes,
 * soft masks, optional content visibility, and Type3 glyph descriptions (their boxes come from the font's `FontBBox`).
 */
import { PliError } from "@pli.dev/core";
import { PdfDict, PdfName, PdfStream, PdfString, isArray, isDict, isName, isNum, isRef, isStream } from "../cos/objects";
import type { PdfObj, PdfRef } from "../cos/objects";
import { parseContentStream, type ContentOp } from "../cos/parser";
import { formatNumber, serializeObject } from "../cos/writer";
import { bytesToLatin1, latin1Bytes } from "../cos/objects";
import type { Rect } from "../model";
import { loadFont, type ContentSource, type DecodedChar, type FontInfo } from "./fontinfo";

// ---- matrices and rectangles ----------------------------------------------------------------------------------------

export type Matrix = [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `a` then `b`: the point goes through `a` first. This is PDF's `a x b`. */
export function mul(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
}
export const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export function invert(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(m[4] * a + m[5] * c), -(m[4] * b + m[5] * d)];
}

export const opKey = (path: string, local: number): string => (path ? `${path}~${local}` : String(local));

export function rectOf(points: readonly (readonly [number, number])[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Whether two rectangles overlap by more than `eps` in both directions. */
export function overlaps(a: Rect, b: Rect, eps = 0): boolean {
  return a.x + a.w > b.x + eps && b.x + b.w > a.x + eps && a.y + a.h > b.y + eps && b.y + b.h > a.y + eps;
}
export function containsRect(outer: Rect, inner: Rect, eps = 0): boolean {
  return inner.x >= outer.x - eps && inner.y >= outer.y - eps && inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;
}
export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

// ---- what the interpreter reports ------------------------------------------------------------------------------------

export interface ShowGlyph {
  /** Index among the glyphs of the operator. */
  index: number;
  /** Which element of a `TJ` array (0 for `Tj`). */
  elem: number;
  /** Byte range in that string. */
  start: number;
  end: number;
  code: number;
  unicode: string;
  /** Displacement of the text position this glyph causes (text space units, includes `Tc` and `Tw`). */
  tx: number;
  /** Where the glyph starts, in text space relative to the start of the operator (what `Td` would have to move by). */
  at: [number, number];
  /** The glyph's box in page space. */
  box: Rect;
  /** The glyph origin in page space and where its advance ends. */
  origin: [number, number];
  end_: [number, number];
}

export interface ShowOp {
  /** Names the operator: its index in its stream, with the stream's path in front for forms (`Fm1~12`). */
  key: string;
  /** Index in the operator list of its stream. */
  local: number;
  /** Which stream: `""` for the page, else form names joined by `/`. */
  stream: string;
  name: string;
  args: PdfObj[];
  font: FontInfo;
  fontName: string;
  /** `Tf` size. */
  size: number;
  th: number;
  tc: number;
  tw: number;
  render: number;
  vertical: boolean;
  glyphs: ShowGlyph[];
  /** The text matrix at the start of the operator (text space to the user space of the stream the operator is in). */
  tm: Matrix;
  rise: number;
  /** Text space to the default user space, at the start of the operator. */
  textMatrix: Matrix;
  /** Text space to page space at the start (with the font size and scaling applied: glyph units to page units). */
  startMatrix: Matrix;
  /** The em in page units (font size times the matrix scale). */
  em: number;
  /** Baseline direction in page space (unit vector). */
  dir: [number, number];
  fill: { css?: string; ops: ContentOp[] };
  /** The scope (resources) of the stream the operator is in. */
  scope: Scope;
}

export interface ImagePlacement {
  /** `i:Im0`, `i:Fm1/Im3`, `i:inline1`, repeated placements `i:Im0#2`. */
  id: string;
  name: string;
  inline: boolean;
  key: string;
  local: number;
  stream: string;
  /** The image object (`undefined` for an inline image). */
  xobject?: PdfStream;
  ref?: PdfRef;
  /** The dictionary (inline images: with the abbreviated keys). */
  dict: PdfDict;
  /** Inline image data. */
  data?: Uint8Array;
  width: number;
  height: number;
  /** Unit square to the user space of the stream. */
  ctm: Matrix;
  /** Unit square to page space (the picture's top left is (0, 1) of the unit square). */
  pageMatrix: Matrix;
  box: Rect;
  scope: Scope;
}

export interface PathPart {
  ops: ContentOp[];
  bbox: Rect;
  /** Only rectangles (`re`). */
  rect: boolean;
}

export interface PathInfo {
  parts: PathPart[];
  /** Line width in page units. */
  lineWidth: number;
  stroke: boolean;
  fill: boolean;
  clip: boolean;
  scope: Scope;
}

export interface PathAction {
  /** Subpaths (indexes in `parts`) to leave out. */
  drop?: ReadonlySet<number>;
  /** Do not paint: the path is only kept for its clip (and left out entirely when it has none). */
  noPaint?: boolean;
  /** Page-space rectangles to paint around, not in (a clip with holes). */
  clipOut?: readonly Rect[];
}

export type ImageAction = { kind: "remove" } | { kind: "ops"; ops: ContentOp[] };

export interface ShowAction {
  /** Glyph indexes to take out of the operator. */
  remove?: ReadonlySet<number>;
  /** Operators to put after the text object (`ET`) this one is in. They may add resources through the scope. */
  after?: (scope: Scope) => ContentOp[];
}

/** Resources of a stream, changed on a private copy only when something is added. */
export class Scope {
  private copy: PdfDict | null = null;
  readonly touched = new Set<string>();
  readonly used = new Set<string>();
  private counter = 0;
  constructor(
    readonly source: ContentSource,
    readonly resources: PdfDict,
  ) {}

  get changed(): boolean {
    return this.copy !== null;
  }

  lookup(category: string, name: string): PdfObj | undefined {
    const dict = this.source.get((this.copy ?? this.resources).get(category));
    return isDict(dict) ? dict.get(name) : undefined;
  }

  private readonly owned = new Set<string>();
  private own(category: string): PdfDict {
    if (!this.copy) this.copy = this.resources.clone();
    if (!this.owned.has(category)) {
      const cur = this.copy.get(category);
      const resolved = isRef(cur) ? this.source.get(cur) : cur;
      this.copy.set(category, isDict(resolved) ? resolved.clone() : new PdfDict());
      this.owned.add(category);
    }
    return this.copy.get(category) as PdfDict;
  }

  /** Adds an entry under a fresh name (`prefix` + number) and returns the name. */
  add(category: "XObject" | "Font" | "ExtGState", prefix: string, value: PdfObj): string {
    const sub = this.own(category);
    let name: string;
    do name = `${prefix}${++this.counter}`;
    while (sub.has(name));
    sub.set(name, value);
    return name;
  }
  addXObject(ref: PdfRef): string {
    return this.add("XObject", "PliX", ref);
  }
  addFont(ref: PdfRef): string {
    return this.add("Font", "PliF", ref);
  }

  /** Marks an entry as replaced (its old name is dropped from the resources if nothing in the new content still uses it). */
  replaced(category: "XObject", name: string): void {
    this.own(category);
    this.touched.add(category + "/" + name);
  }

  /** The resources to write: with replaced entries that are no longer used taken out. Null when nothing changed. */
  finish(): PdfDict | null {
    if (!this.copy) return null;
    for (const t of this.touched) {
      const [category, name] = [t.slice(0, t.indexOf("/")), t.slice(t.indexOf("/") + 1)];
      if (category === "XObject" && !this.used.has(name)) {
        const sub = this.copy.get("XObject");
        if (isDict(sub)) sub.delete(name);
      }
    }
    return this.copy;
  }
}

export interface Rewriter {
  show?(op: ShowOp): ShowAction | undefined;
  image?(img: ImagePlacement): ImageAction | undefined;
  path?(path: PathInfo): PathAction | undefined;
  /** Rectangles (page space) a shading fill must stay out of. */
  shading?(): readonly Rect[] | undefined;
  /** Whether to go into a form XObject (and rewrite its content on a private copy). */
  form?(info: { name: string; path: string; box: Rect | null }): boolean;
  /** Makes the new form object from rewritten operators; returns its reference. */
  writeForm?(original: PdfStream, ops: ContentOp[], resources: PdfDict | null): PdfRef;
  /** Take the text of marked-content properties (`/ActualText`, `/Alt`) out of the content. */
  stripMarkedText?: boolean;
}

export interface InterpretResult {
  ops: ContentOp[];
  changed: boolean;
  /** Left over `q` nesting at the end (the writer must close them). */
  depth: number;
  scope: Scope;
}

interface GState {
  ctm: Matrix;
  font: FontInfo | null;
  fontName: string;
  size: number;
  tc: number;
  tw: number;
  th: number;
  tl: number;
  rise: number;
  render: number;
  fillCs: string;
  fillCss: string | undefined;
  fillOps: ContentOp[];
  lineWidth: number;
}

const MAX_DEPTH = 12;
const PAINT = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n"]);
const CONSTRUCT = new Set(["m", "l", "c", "v", "y", "re", "h"]);

const hex2 = (v: number): string => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
const gray = (g: number): string => `#${hex2(g)}${hex2(g)}${hex2(g)}`;
const rgb = (r: number, g: number, b: number): string => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const cmyk = (c: number, m: number, y: number, k: number): string => rgb((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));

const nums = (args: PdfObj[]): number[] => args.filter(isNum);

export class Interpreter {
  /** Occurrences of each form name per stream, so a form drawn twice gets two paths. */
  readonly #formCounts = new Map<string, number>();
  readonly shows: ShowOp[] = [];
  readonly images: ImagePlacement[] = [];
  /** Codes of each font seen shown, for deciding which characters an embedded subset can still write. */
  readonly used = new Map<FontInfo, Set<number>>();
  readonly #fonts = new Map<string, FontInfo>();
  readonly #fontsByDict = new WeakMap<PdfDict, FontInfo>();
  readonly #parsed = new WeakMap<PdfStream, ContentOp[]>();
  readonly #imageCounts = new Map<string, number>();
  readonly #inlineCounts = new Map<string, number>();
  /** Page space to user space is `base` inverted; `base` takes default user space to page space. */
  constructor(
    readonly source: ContentSource,
    /** Default user space to page space: [1 0 0 -1 -x0 y1]. */
    readonly base: Matrix,
    readonly rewriter?: Rewriter,
    readonly pageSize: { width: number; height: number } = { width: 612, height: 792 },
  ) {}

  /** The operators of a stream object, parsed once. */
  parse(stream: PdfStream): ContentOp[] {
    let ops = this.#parsed.get(stream);
    if (!ops) {
      let bytes: Uint8Array;
      try {
        bytes = this.source.decode(stream);
      } catch (e) {
        // Reading goes on without it; rewriting must not: a form that cannot be read cannot be cleaned.
        if (this.rewriter) throw new PliError("unsupported", `a form on the page could not be decoded (${e instanceof Error ? e.message : "unknown error"}), so it cannot be redacted or edited safely`);
        bytes = new Uint8Array(0);
      }
      this.#parsed.set(stream, (ops = parseContentStream(bytes)));
    }
    return ops;
  }

  /** Runs the page: its content streams joined, with the page resources. */
  runPage(ops: ContentOp[], resources: PdfDict): InterpretResult {
    return this.run(ops, new Scope(this.source, resources), IDENTITY, "", 0);
  }

  private font(scope: Scope, name: string): FontInfo | null {
    const entry = scope.lookup("Font", name);
    if (entry === undefined) return null;
    if (isRef(entry)) {
      let f = this.#fonts.get(entry.key);
      if (!f) this.#fonts.set(entry.key, (f = loadFont(this.source, entry)));
      return f;
    }
    if (isDict(entry)) {
      let f = this.#fontsByDict.get(entry);
      if (!f) this.#fontsByDict.set(entry, (f = loadFont(this.source, entry)));
      return f;
    }
    return null;
  }

  run(ops: ContentOp[], scope: Scope, ctm: Matrix, path: string, depth: number): InterpretResult {
    const rw = this.rewriter;
    const out: ContentOp[] = [];
    let changed = false;
    let gs: GState = { ctm, font: null, fontName: "", size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, render: 0, fillCs: "DeviceGray", fillCss: "#000000", fillOps: [], lineWidth: 1 };
    const stack: GState[] = [];
    let tm: Matrix = IDENTITY;
    let tlm: Matrix = IDENTITY;
    let pending: ((scope: Scope) => ContentOp[])[] = [];
    let parts: PathPart[] = [];
    let buffered: ContentOp[] = [];
    let current: { ops: ContentOp[]; pts: [number, number][]; rect: boolean } | null = null;
    let clipFlag: ContentOp | null = null;
    let curPoint: [number, number] = [0, 0];

    const pageM = () => mul(gs.ctm, this.base);
    const pt = (x: number, y: number): [number, number] => apply(pageM(), x, y);
    const finishPart = () => {
      if (current && current.pts.length) parts.push({ ops: current.ops, bbox: rectOf(current.pts), rect: current.rect });
      current = null;
    };
    const flushPath = () => {
      finishPart();
      if (buffered.length) out.push(...buffered);
      buffered = [];
      parts = [];
      clipFlag = null;
    };
    const emit = (o: ContentOp) => out.push(o);

    const setFill = (cs: string, css: string | undefined, ops: ContentOp[]) => {
      gs.fillCs = cs;
      gs.fillCss = css;
      gs.fillOps = ops;
    };
    const familyOf = (name: string): string => {
      if (name === "Pattern" || name.startsWith("Device") || name.startsWith("Cal") || name === "G" || name === "RGB" || name === "CMYK") return name;
      const entry = this.source.get(scope.lookup("ColorSpace", name));
      if (isArray(entry) && entry[0] instanceof PdfName) {
        const fam = entry[0].value;
        if (fam === "ICCBased") {
          const s = this.source.get(entry[1]);
          const n = isStream(s) ? s.dict.get("N") : null;
          return n === 1 ? "DeviceGray" : n === 4 ? "DeviceCMYK" : "DeviceRGB";
        }
        return fam;
      }
      return isName(entry) ? entry.value : name;
    };
    const cssFor = (family: string, v: number[]): string | undefined => {
      if (family === "Pattern" || family === "Indexed" || family === "Separation" || family === "DeviceN" || family === "Lab") return undefined;
      if (v.length === 1) return gray(v[0]!);
      if (v.length === 3) return rgb(v[0]!, v[1]!, v[2]!);
      if (v.length === 4) return cmyk(v[0]!, v[1]!, v[2]!, v[3]!);
      return undefined;
    };

    for (let local = 0; local < ops.length; local++) {
      const op = ops[local]!;
      const a = op.args;
      const name = op.op;

      // path construction is buffered so the whole path can be dealt with when it is painted
      if (CONSTRUCT.has(name)) {
        buffered.push(op);
        const n = nums(a);
        const P = (x: number, y: number) => pt(x, y);
        if (name === "re" && n.length >= 4) {
          finishPart();
          const [x, y, w, h] = n as [number, number, number, number];
          const pts = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
          parts.push({ ops: [op], bbox: rectOf(pts), rect: true });
          curPoint = [x, y];
        } else if (name === "m" && n.length >= 2) {
          finishPart();
          current = { ops: [op], pts: [P(n[0]!, n[1]!)], rect: false };
          curPoint = [n[0]!, n[1]!];
        } else {
          if (!current) current = { ops: [], pts: [P(curPoint[0], curPoint[1])], rect: false };
          current.ops.push(op);
          if (name === "l" && n.length >= 2) {
            current.pts.push(P(n[0]!, n[1]!));
            curPoint = [n[0]!, n[1]!];
          } else if (name === "c" && n.length >= 6) {
            current.pts.push(P(n[0]!, n[1]!), P(n[2]!, n[3]!), P(n[4]!, n[5]!));
            curPoint = [n[4]!, n[5]!];
          } else if ((name === "v" || name === "y") && n.length >= 4) {
            current.pts.push(P(n[0]!, n[1]!), P(n[2]!, n[3]!));
            curPoint = [n[2]!, n[3]!];
          }
        }
        continue;
      }
      if (name === "W" || name === "W*") {
        buffered.push(op);
        clipFlag = op;
        finishPart();
        continue;
      }
      if (PAINT.has(name)) {
        finishPart();
        const stroke = name === "S" || name === "s" || name === "B" || name === "B*" || name === "b" || name === "b*";
        const fill = name === "f" || name === "F" || name === "f*" || name === "B" || name === "B*" || name === "b" || name === "b*";
        if (buffered.length === 0) {
          emit(op);
          continue;
        }
        const pm = pageM();
        const action = rw?.path?.({ parts, lineWidth: gs.lineWidth * Math.sqrt(Math.abs(pm[0] * pm[3] - pm[1] * pm[2])), stroke, fill, clip: clipFlag !== null, scope });
        if (!action) {
          out.push(...buffered, op);
        } else {
          changed = true;
          const drop = action.drop ?? new Set<number>();
          const kept: ContentOp[] = [];
          parts.forEach((p, i) => {
            if (!drop.has(i)) kept.push(...p.ops);
          });
          const hasPaint = !action.noPaint && parts.some((_, i) => !drop.has(i));
          const paintOp = hasPaint ? op : { op: "n", args: [] };
          if (clipFlag || hasPaint) {
            const body = [...kept, ...(clipFlag ? [clipFlag] : []), paintOp];
            const wrap = hasPaint && action.clipOut && action.clipOut.length ? this.clipOutOps(action.clipOut, pageM()) : null;
            if (wrap) out.push({ op: "q", args: [] }, ...wrap, ...body, { op: "Q", args: [] });
            else out.push(...body);
          }
        }
        buffered = [];
        parts = [];
        clipFlag = null;
        continue;
      }
      if (buffered.length) flushPath();

      switch (name) {
        case "q":
          stack.push({ ...gs });
          emit(op);
          break;
        case "Q": {
          const s = stack.pop();
          if (s) gs = s;
          emit(op);
          break;
        }
        case "cm": {
          const n = nums(a);
          if (n.length >= 6) gs.ctm = mul(n.slice(0, 6) as Matrix, gs.ctm);
          emit(op);
          break;
        }
        case "w":
          gs.lineWidth = nums(a)[0] ?? 1;
          emit(op);
          break;
        case "BT":
          tm = IDENTITY;
          tlm = IDENTITY;
          emit(op);
          break;
        case "ET":
          emit(op);
          if (pending.length) {
            for (const f of pending) {
              changed = true;
              out.push(...f(scope));
            }
            pending = [];
          }
          break;
        case "Tf": {
          const fname = a[0] instanceof PdfName ? a[0].value : "";
          gs.fontName = fname;
          gs.font = this.font(scope, fname);
          gs.size = nums(a)[0] ?? gs.size;
          emit(op);
          break;
        }
        case "Tc":
          gs.tc = nums(a)[0] ?? 0;
          emit(op);
          break;
        case "Tw":
          gs.tw = nums(a)[0] ?? 0;
          emit(op);
          break;
        case "Tz":
          gs.th = (nums(a)[0] ?? 100) / 100;
          emit(op);
          break;
        case "TL":
          gs.tl = nums(a)[0] ?? 0;
          emit(op);
          break;
        case "Ts":
          gs.rise = nums(a)[0] ?? 0;
          emit(op);
          break;
        case "Tr":
          gs.render = nums(a)[0] ?? 0;
          emit(op);
          break;
        case "Td":
        case "TD": {
          const n = nums(a);
          if (n.length >= 2) {
            if (name === "TD") gs.tl = -n[1]!;
            tlm = mul([1, 0, 0, 1, n[0]!, n[1]!], tlm);
            tm = tlm;
          }
          emit(op);
          break;
        }
        case "Tm": {
          const n = nums(a);
          if (n.length >= 6) {
            tm = n.slice(0, 6) as Matrix;
            tlm = tm;
          }
          emit(op);
          break;
        }
        case "T*":
          tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm);
          tm = tlm;
          emit(op);
          break;
        case "Tj":
        case "TJ":
        case "'":
        case '"': {
          if (name === "'" || name === '"') {
            if (name === '"') {
              const n = nums(a);
              gs.tw = n[0] ?? gs.tw;
              gs.tc = n[1] ?? gs.tc;
            }
            tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm);
            tm = tlm;
          }
          const show = this.show(name, a, local, path, gs, tm, scope);
          tm = show.after;
          const sh = show.op;
          const action = rw?.show?.(sh);
          if (!action || (!action.remove?.size && !action.after)) {
            emit(op);
          } else {
            changed = true;
            if (action.remove?.size) out.push(...this.rebuildShow(sh, action.remove));
            else emit(op);
            if (action.after) pending.push(action.after);
          }
          break;
        }
        case "g":
          setFill("DeviceGray", cssFor("DeviceGray", nums(a)), [op]);
          emit(op);
          break;
        case "rg":
          setFill("DeviceRGB", cssFor("DeviceRGB", nums(a)), [op]);
          emit(op);
          break;
        case "k":
          setFill("DeviceCMYK", cssFor("DeviceCMYK", nums(a)), [op]);
          emit(op);
          break;
        case "cs": {
          const n = a[0] instanceof PdfName ? a[0].value : "DeviceGray";
          const fam = familyOf(n);
          setFill(fam, fam === "Pattern" ? undefined : "#000000", [op]);
          emit(op);
          break;
        }
        case "sc":
        case "scn": {
          const keepCs = gs.fillOps.filter((o) => o.op === "cs");
          setFill(gs.fillCs, cssFor(gs.fillCs, nums(a)), [...keepCs, op]);
          emit(op);
          break;
        }
        case "BDC": {
          if (rw?.stripMarkedText) {
            const props = a[1];
            const tag = a[0];
            if (props instanceof PdfDict && (props.has("ActualText") || props.has("Alt") || props.has("E"))) {
              const d = props.clone();
              d.delete("ActualText");
              d.delete("Alt");
              d.delete("E");
              out.push({ op: "BDC", args: [tag as PdfObj, d] });
              changed = true;
              break;
            }
            if (props instanceof PdfName) {
              const looked = this.source.get(scope.lookup("Properties", props.value));
              if (isDict(looked) && (looked.has("ActualText") || looked.has("Alt") || looked.has("E")) && !(tag instanceof PdfName && tag.value === "OC")) {
                out.push({ op: "BMC", args: [tag as PdfObj] });
                changed = true;
                break;
              }
            }
          }
          emit(op);
          break;
        }
        case "Do": {
          const r = this.doXObject(op, local, path, gs, scope, depth);
          if (r === "keep") emit(op);
          else {
            changed = true;
            out.push(...r);
          }
          break;
        }
        case "BI": {
          const r = this.inlineImage(op, local, path, gs, scope);
          if (r === "keep") emit(op);
          else {
            changed = true;
            out.push(...r);
          }
          break;
        }
        case "sh": {
          const rects = rw?.shading?.();
          if (rects && rects.length) {
            changed = true;
            out.push({ op: "q", args: [] }, ...this.clipOutOps(rects, pageM()), op, { op: "Q", args: [] });
          } else emit(op);
          break;
        }
        default:
          emit(op);
      }
    }
    if (buffered.length) flushPath();
    if (pending.length) {
      for (const f of pending) {
        changed = true;
        out.push(...f(scope));
      }
    }
    for (const o of out) if (o.op === "Do" && o.args[0] instanceof PdfName) scope.used.add(o.args[0].value);
    return { ops: out, changed: changed || scope.changed, depth: stack.length, scope };
  }

  /** `q`, a clip that leaves out the rectangles, and nothing else: the caller adds what to paint and the `Q`. */
  private clipOutOps(rects: readonly Rect[], pageMatrix: Matrix): ContentOp[] {
    const inv = invert(pageMatrix);
    if (!inv) return [];
    const ring = (r: Rect): ContentOp[] => {
      const p = [apply(inv, r.x, r.y), apply(inv, r.x + r.w, r.y), apply(inv, r.x + r.w, r.y + r.h), apply(inv, r.x, r.y + r.h)];
      return [{ op: "m", args: p[0]! }, { op: "l", args: p[1]! }, { op: "l", args: p[2]! }, { op: "l", args: p[3]! }, { op: "h", args: [] }];
    };
    const pad = 50;
    const outer: Rect = { x: -pad, y: -pad, w: this.pageSize.width + 2 * pad, h: this.pageSize.height + 2 * pad };
    return [...ring(outer), ...rects.flatMap(ring), { op: "W*", args: [] }, { op: "n", args: [] }];
  }

  // ---- text ---------------------------------------------------------------------------------------------------------

  private show(name: string, args: PdfObj[], local: number, path: string, gs: GState, tmIn: Matrix, scope: Scope): { op: ShowOp; after: Matrix } {
    const font = gs.font ?? loadFont(this.source, null);
    const vertical = font.vertical;
    const elements: { bytes: Uint8Array; elem: number }[] = [];
    const items: ({ s: number } | { n: number })[] = [];
    if (name === "TJ") {
      const arr = isArray(args[0]) ? args[0] : [];
      arr.forEach((e, i) => {
        if (e instanceof PdfString) {
          elements.push({ bytes: e.bytes, elem: i });
          items.push({ s: elements.length - 1 });
        } else if (isNum(e)) items.push({ n: e });
      });
    } else {
      const s = args[args.length - 1];
      if (s instanceof PdfString) {
        elements.push({ bytes: s.bytes, elem: 0 });
        items.push({ s: 0 });
      }
    }
    const glyphs: ShowGlyph[] = [];
    let tm = tmIn;
    const textToUserStart = mul(tmIn, gs.ctm);
    const size = gs.size;
    const asc = clampAscent(font.ascent);
    const desc = clampDescent(font.descent);
    let used = this.used.get(font);
    if (!used) this.used.set(font, (used = new Set()));
    let dx = 0;
    let dy = 0;
    const advance = (tx: number, ty: number) => {
      tm = mul([1, 0, 0, 1, tx, ty], tm);
      dx += tx;
      dy += ty;
    };
    for (const item of items) {
      if ("n" in item) {
        if (vertical) advance(0, (-item.n / 1000) * size);
        else advance((-item.n / 1000) * size * gs.th, 0);
        continue;
      }
      const el = elements[item.s]!;
      const chars: DecodedChar[] = font.decode(el.bytes);
      for (const ch of chars) {
        used.add(ch.code);
        const trm = mul([size * gs.th, 0, 0, size, 0, gs.rise], mul(tm, mul(gs.ctm, this.base)));
        const w = ch.width;
        let corners: [number, number][];
        let tx: number;
        let ty = 0;
        if (vertical) {
          const hx = 0.5 / (gs.th || 1);
          corners = [apply(trm, -hx, -w), apply(trm, hx, -w), apply(trm, hx, 0), apply(trm, -hx, 0)];
          tx = 0;
          ty = -w * size + gs.tc + (ch.space ? gs.tw : 0);
        } else {
          const b = font.bbox && font.type3 ? font.bbox : null;
          const y0 = b ? b[1] : desc;
          const y1 = b ? b[3] : asc;
          corners = [apply(trm, 0, y0), apply(trm, w, y0), apply(trm, w, y1), apply(trm, 0, y1)];
          tx = (w * size + gs.tc + (ch.space ? gs.tw : 0)) * gs.th;
        }
        glyphs.push({ index: glyphs.length, at: [dx, dy], elem: el.elem, start: ch.start, end: ch.end, code: ch.code, unicode: ch.unicode, tx: vertical ? ty : tx, box: rectOf(corners), origin: apply(trm, 0, 0), end_: apply(trm, vertical ? 0 : w, vertical ? -w : 0) });
        advance(tx, ty);
      }
    }
    const startMatrix = mul([size * gs.th, 0, 0, size, 0, gs.rise], mul(tmIn, mul(gs.ctm, this.base)));
    const scale = Math.hypot(startMatrix[2], startMatrix[3]) / (size || 1);
    const dirLen = Math.hypot(startMatrix[0], startMatrix[1]) || 1;
    const op: ShowOp = {
      key: opKey(path, local),
      local,
      stream: path,
      name,
      args,
      font,
      fontName: gs.fontName,
      size,
      th: gs.th,
      tc: gs.tc,
      tw: gs.tw,
      render: gs.render,
      vertical,
      glyphs,
      tm: tmIn,
      rise: gs.rise,
      textMatrix: textToUserStart,
      startMatrix,
      em: Math.abs(size) * scale,
      dir: [startMatrix[0] / dirLen, startMatrix[1] / dirLen],
      fill: { css: gs.fillCss, ops: gs.fillOps },
      scope,
    };
    this.shows.push(op);
    return { op, after: tm };
  }

  /** The operators that show the same text as `sh` without the glyphs in `remove`, the rest kept where it was. */
  private rebuildShow(sh: ShowOp, remove: ReadonlySet<number>): ContentOp[] {
    const elements: PdfObj[] = [];
    const src = sh.name === "TJ" ? (isArray(sh.args[0]) ? sh.args[0] : []) : [sh.args[sh.args.length - 1] ?? null];
    const perElem = new Map<number, ShowGlyph[]>();
    for (const g of sh.glyphs) {
      const l = perElem.get(g.elem) ?? [];
      l.push(g);
      perElem.set(g.elem, l);
    }
    const unit = sh.vertical ? sh.size : sh.size * sh.th;
    let pendingAdjust = 0;
    const pushNumber = (n: number) => {
      const last = elements[elements.length - 1];
      if (isNum(last)) elements[elements.length - 1] = last + n;
      else elements.push(n);
    };
    const flushAdjust = () => {
      if (pendingAdjust !== 0) pushNumber(pendingAdjust);
      pendingAdjust = 0;
    };
    src.forEach((e, i) => {
      if (e instanceof PdfString) {
        const gl = perElem.get(sh.name === "TJ" ? i : 0) ?? [];
        const kept: number[] = [];
        const flushBytes = () => {
          if (kept.length) {
            flushAdjust();
            elements.push(new PdfString(Uint8Array.from(kept), e.hex));
            kept.length = 0;
          }
        };
        let covered = 0;
        for (const g of gl) {
          if (g.start > covered) for (let b = covered; b < g.start; b++) kept.push(e.bytes[b]!);
          if (remove.has(g.index)) {
            flushBytes();
            // The advance of a glyph in 1/1000 text units: a TJ number of -n moves by n/1000 of the font size.
            if (unit) pendingAdjust += (-g.tx * 1000) / unit;
          } else for (let b = g.start; b < g.end; b++) kept.push(e.bytes[b]!);
          covered = g.end;
        }
        for (let b = covered; b < e.bytes.length; b++) kept.push(e.bytes[b]!);
        flushBytes();
      } else if (isNum(e)) {
        pendingAdjust += e;
      }
    });
    flushAdjust();
    const tj: ContentOp = { op: "TJ", args: [elements.map((x) => (isNum(x) ? Math.round(x * 1000) / 1000 : x))] };
    if (sh.name === "'") return [{ op: "T*", args: [] }, tj];
    if (sh.name === '"') return [{ op: "Tw", args: [sh.args[0] ?? 0] }, { op: "Tc", args: [sh.args[1] ?? 0] }, { op: "T*", args: [] }, tj];
    return [tj];
  }

  // ---- XObjects -------------------------------------------------------------------------------------------------------

  private placement(ctm: Matrix): { pageMatrix: Matrix; box: Rect } {
    const pageMatrix = mul(ctm, this.base);
    return { pageMatrix, box: rectOf([apply(pageMatrix, 0, 0), apply(pageMatrix, 1, 0), apply(pageMatrix, 1, 1), apply(pageMatrix, 0, 1)]) };
  }

  private imageId(path: string, name: string): string {
    const key = `${path}/${name}`;
    const n = (this.#imageCounts.get(key) ?? 0) + 1;
    this.#imageCounts.set(key, n);
    const base = path ? `${path}/${name}` : name;
    return n === 1 ? `i:${base}` : `i:${base}#${n}`;
  }

  private doXObject(op: ContentOp, local: number, path: string, gs: GState, scope: Scope, depth: number): "keep" | ContentOp[] {
    const name = op.args[0] instanceof PdfName ? op.args[0].value : "";
    const entry = scope.lookup("XObject", name);
    const xobj = this.source.get(entry);
    if (!isStream(xobj)) return "keep";
    const subtype = this.source.get(xobj.dict.get("Subtype"));
    const rw = this.rewriter;
    if (isName(subtype, "Image")) {
      const w = this.source.get(xobj.dict.get("Width"));
      const h = this.source.get(xobj.dict.get("Height"));
      const { pageMatrix, box } = this.placement(gs.ctm);
      const img: ImagePlacement = {
        id: this.imageId(path, name),
        name,
        inline: false,
        key: opKey(path, local),
        local,
        stream: path,
        xobject: xobj,
        ref: isRef(entry) ? entry : undefined,
        dict: xobj.dict,
        width: isNum(w) ? w : 0,
        height: isNum(h) ? h : 0,
        ctm: gs.ctm,
        pageMatrix,
        box,
        scope,
      };
      this.images.push(img);
      const action = rw?.image?.(img);
      if (!action) return "keep";
      scope.replaced("XObject", name);
      return action.kind === "remove" ? [] : action.ops;
    }
    if (isName(subtype, "Form") && depth < MAX_DEPTH) {
      const m = this.source.get(xobj.dict.get("Matrix"));
      const matrix: Matrix = isArray(m) && m.length >= 6 && m.every((x) => isNum(this.source.get(x))) ? (m.slice(0, 6).map((x) => this.source.get(x) as number) as Matrix) : IDENTITY;
      const bb = this.source.get(xobj.dict.get("BBox"));
      const ctm = mul(matrix, gs.ctm);
      let box: Rect | null = null;
      if (isArray(bb) && bb.length >= 4) {
        const v = bb.slice(0, 4).map((x) => this.source.get(x));
        if (v.every(isNum)) {
          const pm = mul(ctm, this.base);
          const [x0, y0, x1, y1] = v as number[];
          box = rectOf([apply(pm, x0!, y0!), apply(pm, x1!, y0!), apply(pm, x1!, y1!), apply(pm, x0!, y1!)]);
        }
      }
      const countKey = `${path}/${name}`;
      const occurrence = (this.#formCounts.get(countKey) ?? 0) + 1;
      this.#formCounts.set(countKey, occurrence);
      const formPath = (path ? `${path}/` : "") + name + (occurrence > 1 ? `#${occurrence}` : "");
      if (rw && !rw.form?.({ name, path: formPath, box })) return "keep";
      const res = this.source.get(xobj.dict.get("Resources"));
      const inner = new Scope(this.source, isDict(res) ? res : scope.resources);
      const sub = this.run(this.parse(xobj), inner, ctm, formPath, depth + 1);
      if (!rw) return "keep";
      if (!sub.changed || !rw.writeForm) return "keep";
      // Close any `q` the form left open, so the copy is balanced.
      const ops = sub.ops.slice();
      for (let i = 0; i < sub.depth; i++) ops.push({ op: "Q", args: [] });
      const ref = rw.writeForm(xobj, ops, inner.finish());
      const newName = scope.addXObject(ref);
      scope.replaced("XObject", name);
      return [{ op: "Do", args: [PdfName.of(newName)] }];
    }
    return "keep";
  }

  private inlineImage(op: ContentOp, local: number, path: string, gs: GState, scope: Scope): "keep" | ContentOp[] {
    const dict = op.args[0];
    const data = op.args[1];
    if (!(dict instanceof PdfDict) || !(data instanceof PdfString)) return "keep";
    const get = (s: string, l: string): PdfObj | undefined => dict.get(s) ?? dict.get(l);
    const w = get("W", "Width");
    const h = get("H", "Height");
    const { pageMatrix, box } = this.placement(gs.ctm);
    const key = path;
    const n = (this.#inlineCounts.get(key) ?? 0) + 1;
    this.#inlineCounts.set(key, n);
    const img: ImagePlacement = {
      id: `i:${path ? path + "/" : ""}inline${n}`,
      name: `inline${n}`,
      inline: true,
      key: opKey(path, local),
      local,
      stream: path,
      dict,
      data: data.bytes,
      width: isNum(w) ? w : 0,
      height: isNum(h) ? h : 0,
      ctm: gs.ctm,
      pageMatrix,
      box,
      scope,
    };
    this.images.push(img);
    const action = this.rewriter?.image?.(img);
    if (!action) return "keep";
    return action.kind === "remove" ? [] : action.ops;
  }
}

/** Glyph boxes use the font's ascent and descent, kept within sensible bounds (a font that claims 3 em of ascent would cover the lines above it). */
function clampAscent(a: number): number {
  return Math.min(Math.max(a, 0.5), 1.0);
}
function clampDescent(d: number): number {
  return Math.max(Math.min(d, -0.05), -0.35);
}

// ---- writing operators back --------------------------------------------------------------------------------------------

function serializeArg(o: PdfObj): string {
  if (typeof o === "number") return formatNumber(o);
  return bytesToLatin1(serializeObject(o));
}

/** The operators as content stream bytes. Inline images are written with their data. */
export function serializeOps(ops: readonly ContentOp[]): Uint8Array {
  const parts: string[] = [];
  for (const op of ops) {
    if (op.op === "BI") {
      const d = op.args[0];
      const data = op.args[1];
      let s = "BI";
      if (d instanceof PdfDict) for (const [k, v] of d.map) s += ` /${k} ${serializeArg(v as PdfObj)}`;
      s += "\nID ";
      s += data instanceof PdfString ? bytesToLatin1(data.bytes) : "";
      s += "\nEI";
      parts.push(s);
    } else if (op.args.length) parts.push(op.args.map(serializeArg).join(" ") + " " + op.op);
    else parts.push(op.op);
  }
  return latin1Bytes(parts.join("\n") + "\n");
}
