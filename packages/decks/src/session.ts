import { createId, PliError, Session, type ChangeEvent, type TransactOptions } from "@pli.dev/core";
import { MASTER_TITLE_PROMPT, levelPromptParagraphs, newId, slideFromLayout, withFreshIds, withLevelPrompts } from "./build";
import { createDeck } from "./build";
import { sampleChartData } from "./charts";
import type {
  Animation,
  ChartElement,
  ChartType,
  Crop,
  Deck,
  Element,
  Fill,
  GroupElement,
  ImageElement,
  Layout,
  LayoutKind,
  LevelStyle,
  Marks,
  Master,
  Paragraph,
  ParaProps,
  PlaceholderType,
  ShapeElement,
  Slide,
  SlideSize,
  TableCell,
  TableElement,
  TableRow,
  TextBody,
  Theme,
  Transition,
} from "./model";
import { deckReducer, elementIds, findLayout, type DeckOp, type LayoutPatch, type MasterPatch, type SlidePatch } from "./ops";
import { normalizeOps } from "./normalize";
import { mapDeckSelection } from "./sync";
import { CommentCommands, stripCommentMarks } from "./comments";
import { animationProblem, makeAnimation, pruneAnimations, remapAnimations, type AnimationInput } from "./animation";
import { matchPlaceholder, placeholderFamily, resolveSlide, resolveTemplate, type ResolvedElement, type Scene, type SceneContext } from "./resolve";
import { applyMarks, applyMarksAll, ordered, paragraphText, paragraphsFromText, setParagraphProps, type MarksPatch, type TextRange } from "./text";

/** What is selected, saved with each undo step so that undo puts the selection back. */
export interface DeckSelection {
  /** The slide shown on the canvas. */
  slide: string | null;
  /** Slides selected in the filmstrip (the shown slide is among them). */
  slides?: string[];
  /** Selected elements on the shown slide, layout or master. */
  elements: string[];
  /** The text being edited, if any. */
  text?: { element: string; range: TextRange };
}

export type DeckChangeEvent = ChangeEvent<Deck, DeckOp, DeckSelection>;

export interface DeckSessionOptions {
  /** Today's date as text, for date fields. */
  date?: () => string;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Arrange = "front" | "back" | "forward" | "backward";
export type AlignTo = "left" | "center" | "right" | "top" | "middle" | "bottom";

export interface FindHit {
  /** `notes` hits have no element. */
  slide: string;
  element?: string;
  /** A table cell `[row, col]`. */
  cell?: [number, number];
  paragraph: number;
  offset: number;
  length: number;
}

/** What copying elements puts on the clipboard. */
export interface ElementClip {
  format: "pli.deck.elements";
  elements: Element[];
  /** The animations of the copied elements (their `target` is the copied element's id). */
  animations?: Animation[];
}

/** A copy of a slide with new ids all through, and its animations pointed at the new elements. */
export function cloneSlide(src: Slide, id: string = newId("s_")): Slide {
  const map = new Map<string, string>();
  const elements = src.elements.map((e) => {
    const n = withNewIds(e);
    map.set(e.id, n.id);
    return n;
  });
  const { animations: _a, ...rest } = clone(src);
  const copy: Slide = { ...rest, id, elements };
  const animations = remapAnimations(src.animations ?? [], map, newId);
  if (animations.length) copy.animations = animations;
  return copy;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A copy of an element and everything inside it with new ids. */
export function withNewIds<T extends Element>(el: T): T {
  const copy = clone(el);
  const walk = (e: Element) => {
    e.id = newId("e_");
    if (e.type === "group") e.children.forEach(walk);
  };
  walk(copy);
  stripCommentMarks(copy);
  return copy;
}

export function boundsOf(boxes: readonly Box[]): Box {
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function shifted(el: Element, dx: number, dy: number, frames: Map<string, Box>): Element {
  const f = frames.get(el.id);
  const next = { ...el, x: (el.x ?? f?.x ?? 0) + dx, y: (el.y ?? f?.y ?? 0) + dy } as Element;
  if (next.w === undefined && f) next.w = f.w;
  if (next.h === undefined && f) next.h = f.h;
  if (next.type === "group") next.children = next.children.map((c) => shifted(c, dx, dy, frames));
  return next;
}

/** The cell that owns the grid square `(r, c)`: the square itself, or the merged cell that covers it. */
function originOfCell(rows: readonly TableRow[], r: number, c: number): { r: number; c: number } | undefined {
  if (!rows[r]?.cells[c]) return undefined;
  if (!rows[r]!.cells[c]!.covered) return { r, c };
  for (let rr = r; rr >= 0; rr--)
    for (let cc = c; cc >= 0; cc--) {
      const cell = rows[rr]?.cells[cc];
      if (!cell || cell.covered) continue;
      if (rr + (cell.rowSpan ?? 1) - 1 >= r && cc + (cell.colSpan ?? 1) - 1 >= c) return { r: rr, c: cc };
    }
  return undefined;
}

/** The cell that owns the grid square `(r, c)` of a table (see merged cells), or undefined outside it. */
export function tableCellOrigin(table: TableElement, r: number, c: number): { r: number; c: number } | undefined {
  return originOfCell(table.rows, r, c);
}

type ParaPatch = Parameters<typeof setParagraphProps>[2];

const PARA_KEYS = ["align", "marL", "indent", "bullet", "spaceBefore", "spaceAfter", "lineSpacing", "rtl"] as const satisfies readonly (keyof ParaProps)[];

/** A level style with marks and paragraph properties changed (`null` or `undefined` removes one; for `bullet`, `null` is "no bullet"). */
function updatedLevel(style: LevelStyle | undefined, marks: MarksPatch | undefined, para: ParaPatch | undefined): LevelStyle {
  const out: LevelStyle = { ...style };
  if (marks) {
    const m: Record<string, unknown> = { ...style?.marks };
    for (const [k, v] of Object.entries(marks)) {
      if (v === null || v === undefined) delete m[k];
      else m[k] = v;
    }
    if (Object.keys(m).length) out.marks = m as Marks;
    else delete out.marks;
  }
  if (para) {
    for (const k of PARA_KEYS) {
      if (!(k in para)) continue;
      const v = para[k];
      if (k === "bullet" && v === null) out.bullet = null;
      else if (v === null || v === undefined) delete out[k];
      else (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/** A level style without some marks and paragraph properties (so that what a master level now says shows through). */
function withoutKeys(style: LevelStyle, marks: readonly string[], para: readonly string[]): LevelStyle {
  const out: LevelStyle = { ...style };
  if (style.marks && marks.length) {
    const m: Record<string, unknown> = { ...style.marks };
    for (const k of marks) delete m[k];
    if (Object.keys(m).length) out.marks = m as Marks;
    else delete out.marks;
  }
  for (const k of para) delete (out as Record<string, unknown>)[k];
  return out;
}

const clampLevel = (p: Paragraph): number => Math.min(8, Math.max(0, p.level ?? 0));

/** A name not yet used by a master of the deck: `Name`, then `Name (2)`, `Name (3)`. */
function freeName(deck: Deck, name: string): string {
  const taken = new Set(deck.masters.map((m) => m.name));
  if (!taken.has(name)) return name;
  const base = name.replace(/ \(\d+\)$/, "");
  for (let n = 2; ; n++) if (!taken.has(`${base} (${n})`)) return `${base} (${n})`;
}

/** Where a new placeholder goes by default, for a slide of this size (the proportions of the built-in masters). */
function placeholderBox(type: PlaceholderType, size: SlideSize): { x: number; y: number; w: number; h: number } {
  const k = size.width / 720;
  const m = 36 * k;
  const W = size.width;
  const H = size.height;
  switch (type) {
    case "title":
    case "ctrTitle":
      return { x: m, y: 22 * k, w: W - 2 * m, h: 64 * k };
    case "dt":
      return { x: m, y: H - 30 * k, w: 150 * k, h: 20 * k };
    case "ftr":
      return { x: W / 2 - 150 * k, y: H - 30 * k, w: 300 * k, h: 20 * k };
    case "sldNum":
      return { x: W - m - 60 * k, y: H - 30 * k, w: 60 * k, h: 20 * k };
    case "subTitle":
      return { x: m, y: H * 0.24 + 112 * k, w: W - 2 * m, h: 60 * k };
    default:
      return { x: m, y: 98 * k, w: W - 2 * m, h: H - 98 * k - 40 * k };
  }
}

const DEFAULT_IDX: Partial<Record<PlaceholderType, number>> = { dt: 10, ftr: 11, sldNum: 12 };

/** The deck editor's engine: a document with invertible operations, undo and redo, and the editing commands built on them. */
export class DeckSession {
  readonly #session: Session<Deck, DeckOp, DeckSelection>;
  readonly #options: DeckSessionOptions;
  /** Sessions remember the selection a command should leave behind; the editor sets it before commands. */
  selection: DeckSelection = { slide: null, elements: [] };
  /** Comment threads: `session.comments.enable({ users })` turns them on. */
  readonly comments = new CommentCommands(this);
  /** True while a `SyncClient` keeps this deck in step with a shared one (set by whatever starts it): comments then travel with the changes. */
  syncing = false;

  constructor(deck: Deck = createDeck(), options: DeckSessionOptions = {}) {
    this.#session = new Session<Deck, DeckOp, DeckSelection>(deck, deckReducer);
    this.#options = options;
    this.selection = { slide: deck.slides[0]?.id ?? null, elements: [] };
    this.#previous = deck;
    // What other people do to the deck can take away what this person has selected.
    this.#session.subscribe((event) => {
      if (event.origin !== "remote") return;
      if (event.reset) {
        const sel = this.selection;
        const d = event.state;
        const slide = sel.slide && (d.slides.some((s) => s.id === sel.slide) || d.masters.some((m) => m.id === sel.slide || m.layouts.some((l) => l.id === sel.slide))) ? sel.slide : (d.slides[0]?.id ?? null);
        this.selection = slide === sel.slide ? sel : { slide, elements: [] };
        return;
      }
      const before = this.selection;
      const mapped = mapDeckSelection(before, event.ops) ?? before;
      if (mapped.slide === null && before.slide !== null) {
        // The slide on the canvas was deleted: show the one that took its place.
        const old = this.#previous;
        const at = old ? old.slides.findIndex((s) => s.id === before.slide) : -1;
        const slides = event.state.slides;
        this.selection = { slide: slides[Math.min(Math.max(at, 0), slides.length - 1)]?.id ?? null, elements: [] };
      } else this.selection = mapped;
    });
    this.#session.subscribe((event) => {
      this.#previous = event.state;
      // Two people can each delete a different slide while it is not the last one: a deck always has a slide, so someone puts one back.
      // Other people's changes can leave an animation pointing at an object someone deleted: it is taken off, the same way for everyone.
      if (event.origin === "remote" && event.state.slides.some((s) => s.animations?.length && pruneAnimations(s) !== s)) {
        queueMicrotask(() => {
          const ops: DeckOp[] = [];
          for (const s of this.deck.slides) {
            const kept = s.animations?.length ? pruneAnimations(s) : s;
            if (kept !== s) ops.push({ type: "patch_slide", id: s.id, patch: { animations: kept.animations ?? null } });
          }
          if (ops.length) this.#session.transact(ops, { history: false });
        });
      }
      if (event.origin === "remote" && event.state.slides.length === 0 && event.state.masters.length > 0) queueMicrotask(() => this.deck.slides.length === 0 && this.addSlide({ after: null }));
    });
  }
  /** The deck before the change being announced, for working out what a remote change took away. */
  #previous: Deck | null = null;

  // ---- State ----------------------------------------------------------------------------------------------------

  get deck(): Deck {
    return this.#session.state;
  }
  get canUndo(): boolean {
    return this.#session.canUndo;
  }
  get canRedo(): boolean {
    return this.#session.canRedo;
  }
  undo(): boolean {
    return this.#session.undo();
  }
  redo(): boolean {
    return this.#session.redo();
  }
  subscribe(listener: (event: DeckChangeEvent) => void): () => void {
    return this.#session.subscribe(listener);
  }
  /** Replaces the whole deck (a file was opened) and forgets the history. */
  load(deck: Deck): void {
    this.#session.reset(deck);
    this.selection = { slide: deck.slides[0]?.id ?? null, elements: [] };
  }
  /**
   * The engine under this session (`@pli.dev/core`'s `Session`): what a `SyncClient` is given for live editing. Changes made
   * with the commands are written as fine-grained operations (one value, one stretch of text), which is what lets two people's
   * changes to one slide merge.
   */
  get core(): Session<Deck, DeckOp, DeckSelection> {
    return this.#session;
  }
  /** Applies operations as one undoable step. */
  transact(ops: readonly DeckOp[], options: TransactOptions<DeckSelection> = {}): void {
    this.#session.transact(normalizeOps(this.deck, this.#withAnimationCleanup(ops)), { before: this.selection, ...options });
  }
  /** Applies operations that came from somewhere else (another person's edits); they don't enter this person's history. */
  applyRemote(ops: readonly DeckOp[]): void {
    this.#session.transact(ops, { origin: "remote" });
  }

  slide(id: string): Slide {
    const s = this.deck.slides.find((x) => x.id === id);
    if (!s) throw new PliError("not_found", `No slide "${id}"`);
    return s;
  }
  slideIndex(id: string): number {
    return this.deck.slides.findIndex((s) => s.id === id);
  }
  layout(id: string): { master: Master; layout: Layout } {
    const f = findLayout(this.deck, id);
    if (!f) throw new PliError("not_found", `No layout "${id}"`);
    return f;
  }
  /** The elements of a slide, layout or master. */
  elementsOf(owner: string): Element[] {
    const d = this.deck;
    return d.slides.find((s) => s.id === owner)?.elements ?? findLayout(d, owner)?.layout.elements ?? d.masters.find((m) => m.id === owner)?.elements ?? this.#missing(owner);
  }
  #missing(owner: string): never {
    throw new PliError("not_found", `No slide, layout or master "${owner}"`);
  }
  element(owner: string, id: string): Element {
    const find = (list: readonly Element[]): Element | undefined => {
      for (const e of list) {
        if (e.id === id) return e;
        if (e.type === "group") {
          const inner = find(e.children);
          if (inner) return inner;
        }
      }
      return undefined;
    };
    const e = find(this.elementsOf(owner));
    if (!e) throw new PliError("not_found", `No element "${id}"`);
    return e;
  }

  /** What a slide (or a layout or master, edited as a template) looks like with everything inherited. */
  scene(owner: string, ctx: SceneContext = {}): Scene {
    const d = this.deck;
    const slide = d.slides.find((s) => s.id === owner);
    if (slide) return resolveSlide(d, slide, { slideNumber: d.slides.indexOf(slide) + 1, slideCount: d.slides.length, date: this.#options.date?.(), ...ctx });
    return resolveTemplate(d, owner, { date: this.#options.date?.(), ...ctx });
  }

  /** The frames of an owner's top-level elements as drawn (inheritance applied). */
  frames(owner: string): Map<string, Box> {
    const map = new Map<string, Box>();
    const walk = (list: ResolvedElement[]) => {
      for (const r of list) {
        if (r.from === (this.deck.slides.some((s) => s.id === owner) ? "slide" : findLayout(this.deck, owner) ? "layout" : "master")) map.set(r.id, { x: r.x, y: r.y, w: r.w, h: r.h });
        if (r.children) walk(r.children);
      }
    };
    walk(this.scene(owner).elements);
    return map;
  }

  // ---- Deck -----------------------------------------------------------------------------------------------------

  setTitle(title: string): void {
    this.transact([{ type: "set_deck", patch: { title } }]);
  }

  /** Changes the slide size. With `scale`, everything on slides, layouts and masters is scaled to fit. */
  setSize(size: SlideSize, scale = true): void {
    const old = this.deck.size;
    const ops: DeckOp[] = [{ type: "set_deck", patch: { size } }];
    if (scale && (size.width !== old.width || size.height !== old.height)) {
      const fx = size.width / old.width;
      const fy = size.height / old.height;
      const f = Math.min(fx, fy);
      const scaleEl = (e: Element): Element => {
        const n: Record<string, unknown> = { ...e };
        if (e.x !== undefined) n.x = e.x * fx;
        if (e.y !== undefined) n.y = e.y * fy;
        if (e.w !== undefined) n.w = e.w * fx;
        if (e.h !== undefined) n.h = e.h * fy;
        if (e.type === "group") n.children = e.children.map(scaleEl);
        if (e.type === "shape" && e.text) n.text = scaleBody(e.text, f);
        if (e.type === "chart") {
          if (e.textSize !== undefined) n.textSize = e.textSize * f;
          if (e.titleSize !== undefined) n.titleSize = e.titleSize * f;
        }
        if (e.type === "table") {
          n.columns = e.columns.map((c) => c * fx);
          n.rows = e.rows.map((r) => ({ ...r, h: r.h * fy, cells: r.cells.map((c) => ({ ...c, paragraphs: scaleParas(c.paragraphs, f) })) }));
        }
        return n as unknown as Element;
      };
      const scaleParas = (ps: Paragraph[], k: number): Paragraph[] =>
        ps.map((p) => ({ ...p, runs: p.runs.map((r) => (r.marks?.fontSize ? { ...r, marks: { ...r.marks, fontSize: r.marks.fontSize * k } } : r)) }));
      const scaleBody = (b: TextBody, k: number): TextBody => ({
        ...b,
        paragraphs: scaleParas(b.paragraphs, k),
        levels: b.levels ? Object.fromEntries(Object.entries(b.levels).map(([l, s]) => [l, s.marks?.fontSize ? { ...s, marks: { ...s.marks, fontSize: s.marks.fontSize * k } } : s])) : undefined,
      });
      for (const s of this.deck.slides) ops.push({ type: "set_elements", owner: s.id, elements: s.elements.map(scaleEl) });
      for (const m of this.deck.masters) {
        ops.push({ type: "set_elements", owner: m.id, elements: m.elements.map(scaleEl) });
        for (const l of m.layouts) ops.push({ type: "set_elements", owner: l.id, elements: l.elements.map(scaleEl) });
        const ts = (styles: Record<number, import("./model").LevelStyle>) =>
          Object.fromEntries(Object.entries(styles).map(([l, s]) => [l, s.marks?.fontSize ? { ...s, marks: { ...s.marks, fontSize: s.marks.fontSize * f } } : s]));
        ops.push({ type: "patch_master", id: m.id, patch: { textStyles: { title: ts(m.textStyles.title), body: ts(m.textStyles.body), other: ts(m.textStyles.other) } } });
      }
    }
    this.transact(ops);
  }

  // ---- Slides ---------------------------------------------------------------------------------------------------

  /** Adds a slide after another (the shown one by default) with a layout (the one before's by default). */
  addSlide(options: { layout?: string; after?: string | null; index?: number } = {}): Slide {
    const d = this.deck;
    const after = options.after === undefined ? this.selection.slide : options.after;
    const prev = after ? d.slides.find((s) => s.id === after) : undefined;
    const index = options.index ?? (prev ? d.slides.indexOf(prev) + 1 : d.slides.length);
    let layoutId = options.layout;
    if (!layoutId) {
      // After a title slide, a "title and body" slide is the natural next one.
      const pl = prev ? findLayout(d, prev.layout) : undefined;
      const master = pl?.master ?? d.masters[0]!;
      layoutId = (pl?.layout.kind === "title" ? master.layouts.find((l) => l.kind === "titleAndBody") : pl?.layout)?.id ?? master.layouts[0]!.id;
    }
    const slide = slideFromLayout(this.layout(layoutId).layout);
    this.transact([{ type: "insert_slide", slide, index }], { after: { slide: slide.id, elements: [] } });
    this.selection = { slide: slide.id, elements: [] };
    return slide;
  }

  /** Copies slides (each goes right after its original). Returns the new slides. */
  duplicateSlides(ids: readonly string[]): Slide[] {
    const d = this.deck;
    const sorted = [...ids].sort((a, b) => d.slides.findIndex((s) => s.id === a) - d.slides.findIndex((s) => s.id === b));
    const made: Slide[] = [];
    const ops: DeckOp[] = [];
    let shift = 0;
    for (const id of sorted) {
      const src = this.slide(id);
      const copy = cloneSlide(src);
      made.push(copy);
      ops.push({ type: "insert_slide", slide: copy, index: d.slides.indexOf(src) + 1 + shift++ });
    }
    if (ops.length) this.transact(ops, { after: { slide: made[0]!.id, slides: made.map((s) => s.id), elements: [] } });
    return made;
  }

  deleteSlides(ids: readonly string[]): void {
    const d = this.deck;
    const doomed = d.slides.filter((s) => ids.includes(s.id));
    if (doomed.length === 0) return;
    const keep = d.slides.filter((s) => !ids.includes(s.id));
    const first = d.slides.indexOf(doomed[0]!);
    const next = keep[Math.min(first, keep.length - 1)];
    const ops: DeckOp[] = doomed.map((s) => ({ type: "remove_slide", id: s.id }));
    // a deck always has a slide
    if (keep.length === 0) ops.push({ type: "insert_slide", slide: slideFromLayout(d.masters[0]!.layouts[0]!), index: 0 });
    this.transact(ops);
    this.selection = { slide: next?.id ?? this.deck.slides[0]?.id ?? null, elements: [] };
  }

  /** Moves slides so that they sit together starting at index `to` (counted among the slides that stay). */
  moveSlides(ids: readonly string[], to: number): void {
    const d = this.deck;
    const moving = d.slides.filter((s) => ids.includes(s.id));
    const rest = d.slides.filter((s) => !ids.includes(s.id));
    const at = Math.max(0, Math.min(to, rest.length));
    const order = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    const ops: DeckOp[] = [];
    // Place them one by one into their final positions.
    const cur = [...d.slides];
    order.forEach((s, i) => {
      const from = cur.indexOf(s);
      if (from !== i) {
        ops.push({ type: "move_slide", id: s.id, index: i });
        cur.splice(from, 1);
        cur.splice(i, 0, s);
      }
    });
    if (ops.length) this.transact(ops);
  }

  patchSlides(ids: readonly string[], patch: SlidePatch): void {
    this.transact(ids.map((id) => ({ type: "patch_slide" as const, id, patch })));
  }
  /** Sets a slide's speaker notes. Typing folds into one undo step by default; pass `merge: false` for the first change of a burst. */
  setNotes(id: string, notes: string, options: { merge?: boolean } = {}): void {
    this.transact([{ type: "patch_slide", id, patch: { notes } }], { merge: options.merge ?? true });
  }
  setBackground(ids: readonly string[], fill: Fill | null): void {
    this.patchSlides(ids, { background: fill });
  }
  setTransition(ids: readonly string[], transition: Transition | null): void {
    // "none" with an auto-advance time is kept: the slide still moves on by itself
    this.patchSlides(ids, { transition: transition && (transition.type !== "none" || transition.advanceAfter) ? transition : null });
  }
  setSkipped(ids: readonly string[], skipped: boolean): void {
    this.patchSlides(ids, { skipped: skipped ? true : null });
  }
  renameSlide(id: string, name: string): void {
    this.patchSlides([id], { name: name || null });
  }

  /**
   * Gives a slide another layout. Its placeholders move to the new layout's matching ones; ones with text and no match
   * stay as plain text boxes where they were; empty ones with no match go; placeholders the new layout has that the slide
   * doesn't are added empty.
   */
  setLayout(slideId: string, layoutId: string): void {
    const slide = this.slide(slideId);
    if (slide.layout === layoutId) return;
    const target = this.layout(layoutId).layout;
    const frames = this.frames(slideId);
    const used = new Set<ShapeElement>();
    const elements: Element[] = [];
    for (const el of slide.elements) {
      if (el.type !== "shape" || !el.placeholder) {
        elements.push(el);
        continue;
      }
      const match = matchPlaceholder(target.elements.filter((e) => !used.has(e as ShapeElement)), el.placeholder);
      if (match) {
        used.add(match);
        elements.push({ ...el, placeholder: { ...match.placeholder! } });
      } else if (el.text && el.text.paragraphs.some((p) => paragraphText(p) !== "")) {
        const f = frames.get(el.id);
        const { placeholder: _ph, ...rest } = el;
        elements.push({ ...rest, ...(f ?? {}), textBox: true });
      }
    }
    for (const t of target.elements) {
      if (t.type === "shape" && t.placeholder && !used.has(t) && !["dt", "ftr", "sldNum"].includes(t.placeholder.type)) {
        elements.push({ type: "shape", id: newId("e_"), geometry: "rect", placeholder: { ...t.placeholder }, text: { paragraphs: [{ runs: [] }] } });
      }
    }
    this.transact([{ type: "patch_slide", id: slideId, patch: { layout: layoutId } }, { type: "set_elements", owner: slideId, elements }]);
  }

  /** Clears a slide's placeholders back to the layout's positions and styles. */
  resetSlide(slideId: string): void {
    const slide = this.slide(slideId);
    const elements = slide.elements.map((e) => {
      if (e.type !== "shape" || !e.placeholder) return e;
      const { x: _x, y: _y, w: _w, h: _h, rotation: _r, fill: _f, line: _l, shadow: _s, ...rest } = e;
      return rest as ShapeElement;
    });
    this.transact([{ type: "set_elements", owner: slideId, elements }]);
  }

  // ---- Elements -------------------------------------------------------------------------------------------------

  /** Puts elements on top of an owner. Returns their ids. */
  insertElements(owner: string, elements: readonly Element[], animations: readonly Animation[] = []): string[] {
    const ops: DeckOp[] = elements.map((element) => ({ type: "insert_element" as const, owner, element }));
    const slide = animations.length ? this.deck.slides.find((s) => s.id === owner) : undefined;
    if (slide) ops.push({ type: "patch_slide", id: slide.id, patch: { animations: [...(slide.animations ?? []), ...animations] } });
    this.transact(ops, { after: { slide: this.selection.slide, elements: elements.map((e) => e.id) } });
    this.selection = { ...this.selection, elements: elements.map((e) => e.id) };
    return elements.map((e) => e.id);
  }

  addTextBox(owner: string, box: Partial<Box> = {}, text = ""): ShapeElement {
    const el: ShapeElement = {
      type: "shape",
      id: newId("e_"),
      geometry: "rect",
      textBox: true,
      x: box.x ?? this.deck.size.width * 0.1,
      y: box.y ?? this.deck.size.height * 0.2,
      w: box.w ?? this.deck.size.width * 0.4,
      h: box.h ?? 36,
      text: { paragraphs: paragraphsFromText(text), autofit: "resize" },
    };
    this.insertElements(owner, [el]);
    return el;
  }

  addShape(owner: string, geometry: string, box: Partial<Box> = {}, props: Partial<ShapeElement> = {}): ShapeElement {
    const isLine = /line|connector|arrow$/i.test(geometry) && /line|connector/i.test(geometry);
    const el: ShapeElement = {
      type: "shape",
      id: newId("e_"),
      geometry,
      x: box.x ?? this.deck.size.width * 0.35,
      y: box.y ?? this.deck.size.height * 0.3,
      w: box.w ?? (isLine ? 160 : 140),
      h: box.h ?? (isLine ? 0 : 100),
      ...(isLine ? { line: { width: 2, color: { theme: "dk1" } } } : { fill: { theme: "accent1" }, line: { width: 1, color: { theme: "accent1", lumMod: 0.75 } } }),
      ...props,
    };
    this.insertElements(owner, [el]);
    return el;
  }

  addImage(owner: string, src: string, size: { w: number; h: number }, at?: { x: number; y: number }, extra: Partial<ImageElement> = {}): ImageElement {
    const { width, height } = this.deck.size;
    const k = Math.min(1, (width * 0.8) / size.w, (height * 0.8) / size.h);
    const w = size.w * k;
    const h = size.h * k;
    const el: ImageElement = { type: "image", id: newId("e_"), src, x: at?.x ?? (width - w) / 2, y: at?.y ?? (height - h) / 2, w, h, ...extra };
    this.insertElements(owner, [el]);
    return el;
  }

  addTable(owner: string, rows: number, cols: number, box: Partial<Box> = {}): TableElement {
    const w = box.w ?? this.deck.size.width * 0.8;
    const rowH = 32;
    const el: TableElement = {
      type: "table",
      id: newId("e_"),
      x: box.x ?? this.deck.size.width * 0.1,
      y: box.y ?? this.deck.size.height * 0.3,
      w,
      h: rowH * rows,
      columns: Array.from({ length: cols }, () => w / cols),
      rows: Array.from({ length: rows }, () => ({ h: rowH, cells: Array.from({ length: cols }, () => ({ paragraphs: [{ runs: [] }] })) })),
      headerRow: true,
    };
    this.insertElements(owner, [el]);
    return el;
  }

  /** Adds a chart with sample data (or `props`), centred on the slide unless a box says otherwise. */
  addChart(owner: string, chartType: ChartType, box: Partial<Box> = {}, props: Partial<ChartElement> = {}): ChartElement {
    const { width, height } = this.deck.size;
    const w = box.w ?? Math.min(480, width * 0.6);
    const h = box.h ?? Math.min(300, height * 0.6);
    const el: ChartElement = { ...sampleChartData(chartType), type: "chart", id: newId("e_"), x: box.x ?? (width - w) / 2, y: box.y ?? (height - h) / 2, w, h, ...props };
    this.insertElements(owner, [el]);
    return el;
  }

  /** Changes a chart: fields to set (`undefined` removes one) or a function that returns the new chart. One undoable step. */
  updateChart(owner: string, id: string, change: ((chart: ChartElement) => ChartElement) | Partial<ChartElement>): void {
    this.updateElement(owner, id, (e) => {
      if (e.type !== "chart") throw new PliError("invalid_operation", "Not a chart");
      if (typeof change === "function") return change(e);
      const next: Record<string, unknown> = { ...e };
      for (const [k, v] of Object.entries(change)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      return next as unknown as ChartElement;
    });
  }

  /** Changes an element: either with fields to set (`null` removes one) or a function that returns the new element. */
  updateElement(owner: string, id: string, change: ((el: Element) => Element) | Record<string, unknown>): void {
    this.updateElements(owner, [id], change);
  }

  updateElements(owner: string, ids: readonly string[], change: ((el: Element) => Element) | Record<string, unknown>, options: TransactOptions<DeckSelection> = {}): void {
    const ops: DeckOp[] = [];
    for (const id of ids) {
      const old = this.element(owner, id);
      let next: Element;
      if (typeof change === "function") next = change(old);
      else {
        const n: Record<string, unknown> = { ...old };
        for (const [k, v] of Object.entries(change)) {
          if (v === null && !["fill", "line", "shadow", "bullet"].includes(k)) delete n[k];
          else n[k] = v;
        }
        next = n as unknown as Element;
      }
      if (next !== old) ops.push({ type: "replace_element", owner, element: next });
    }
    this.transact(ops, options);
  }

  /** Sets the frame (position and size) of an element, detaching a placeholder from the layout's frame. */
  setFrame(owner: string, id: string, frame: Partial<Box> & { rotation?: number }, options: TransactOptions<DeckSelection> = {}): void {
    const f = this.frames(owner).get(id);
    this.updateElement(owner, id, (e) => ({ ...e, ...(f ?? {}), ...frame }) as Element);
    void options;
  }

  moveBy(owner: string, ids: readonly string[], dx: number, dy: number, options: TransactOptions<DeckSelection> = {}): void {
    if (!dx && !dy) return;
    const frames = this.frames(owner);
    const ops: DeckOp[] = [];
    for (const id of ids) {
      const e = this.element(owner, id);
      if (e.locked) continue;
      ops.push({ type: "replace_element", owner, element: shifted(e, dx, dy, frames) });
    }
    this.transact(ops, options);
  }

  /** Several elements' frames at once (a drag or resize ending). */
  setFrames(owner: string, frames: Record<string, Partial<Box> & { rotation?: number }>, options: TransactOptions<DeckSelection> = {}): void {
    const current = this.frames(owner);
    const ops: DeckOp[] = [];
    for (const [id, patch] of Object.entries(frames)) {
      const e = this.element(owner, id);
      const base = current.get(id);
      let next = { ...e, ...(base ?? {}), ...patch } as Element;
      if (e.type === "group" && base && (patch.x !== undefined || patch.y !== undefined || patch.w !== undefined || patch.h !== undefined)) {
        // Scale the children with the group.
        const nb = { x: patch.x ?? base.x, y: patch.y ?? base.y, w: patch.w ?? base.w, h: patch.h ?? base.h };
        const sx = base.w ? nb.w / base.w : 1;
        const sy = base.h ? nb.h / base.h : 1;
        const move = (c: Element): Element => {
          const cf = current.get(c.id) ?? { x: c.x ?? 0, y: c.y ?? 0, w: c.w ?? 0, h: c.h ?? 0 };
          const moved = { ...c, x: nb.x + (cf.x - base.x) * sx, y: nb.y + (cf.y - base.y) * sy, w: cf.w * sx, h: cf.h * sy } as Element;
          if (moved.type === "group") moved.children = moved.children.map(move);
          return moved;
        };
        next = { ...(next as GroupElement), children: (e as GroupElement).children.map(move) };
      }
      ops.push({ type: "replace_element", owner, element: next });
    }
    this.transact(ops, options);
  }

  /** Replaces the text of a shape (or a text placeholder). */
  setText(owner: string, id: string, paragraphs: Paragraph[], options: TransactOptions<DeckSelection> = {}): void {
    const el = this.element(owner, id);
    if (el.type !== "shape") throw new PliError("invalid_operation", "Only shapes hold text");
    this.transact([{ type: "replace_element", owner, element: { ...el, text: { ...el.text, paragraphs } } }], options);
  }

  /** Changes how a table's cell reads. */
  setCellParagraphs(owner: string, id: string, row: number, col: number, paragraphs: Paragraph[], options: TransactOptions<DeckSelection> = {}): void {
    const el = this.element(owner, id);
    if (el.type !== "table") throw new PliError("invalid_operation", "Not a table");
    const rows = el.rows.map((r, ri) => (ri === row ? { ...r, cells: r.cells.map((c, ci) => (ci === col ? { ...c, paragraphs } : c)) } : r));
    this.transact([{ type: "replace_element", owner, element: { ...el, rows } }], options);
  }

  /**
   * Sets marks on a range of an element's text, or on all of it with no range. Several elements take it all. On a placeholder
   * of a layout or master the change goes to the text styles the slides inherit (see `formatTemplateText`).
   */
  formatText(owner: string, ids: readonly string[], patch: MarksPatch, range?: TextRange): void {
    const styled = ids.filter((id) => this.isTemplateText(owner, id));
    const ops: DeckOp[] = [];
    if (styled.length) ops.push(...this.#templateOps(owner, styled, () => ({ marks: patch }), range));
    for (const id of ids) {
      if (styled.includes(id)) continue;
      const el = this.element(owner, id);
      if (el.type === "shape" && el.text) {
        const paragraphs = range ? applyMarks(el.text.paragraphs, range, patch) : applyMarksAll(el.text.paragraphs, patch);
        ops.push({ type: "replace_element", owner, element: { ...el, text: { ...el.text, paragraphs } } });
      } else if (el.type === "table") {
        const rows = el.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, paragraphs: applyMarksAll(c.paragraphs, patch) })) }));
        ops.push({ type: "replace_element", owner, element: { ...el, rows } });
      }
    }
    this.transact(ops);
  }

  /** Sets paragraph properties (alignment, bullets, spacing, level). On a layout or master placeholder they go to the level styles. */
  formatParagraphs(owner: string, ids: readonly string[], patch: ParaPatch, range?: TextRange): void {
    const styled = ids.filter((id) => this.isTemplateText(owner, id));
    const ops: DeckOp[] = [];
    if (styled.length) ops.push(...this.#templateOps(owner, styled, () => ({ para: patch }), range));
    for (const id of ids) {
      if (styled.includes(id)) continue;
      const el = this.element(owner, id);
      if (el.type !== "shape" || !el.text) continue;
      const ps = el.text.paragraphs;
      const r = range ?? { from: { p: 0, o: 0 }, to: { p: Math.max(0, ps.length - 1), o: 0 } };
      ops.push({ type: "replace_element", owner, element: { ...el, text: { ...el.text, paragraphs: setParagraphProps(ps, r, patch) } } });
    }
    this.transact(ops);
  }

  // ---- Styling a template's text -------------------------------------------------------------------------------------

  /** Whether text formatting of this element edits the inherited text styles: it is a placeholder on a layout or master. */
  isTemplateText(owner: string, id: string): boolean {
    const d = this.deck;
    if (d.slides.some((s) => s.id === owner)) return false;
    if (!findLayout(d, owner) && !d.masters.some((m) => m.id === owner)) return false;
    const el = this.element(owner, id);
    return el.type === "shape" && !!el.placeholder;
  }

  /**
   * Formats the text of a layout or master placeholder the way PowerPoint's Slide Master view does: the change is written to
   * the style of each paragraph's level, not just to the runs. On a layout that is the placeholder's own `text.levels`; on a
   * master it is `textStyles.title` or `.body` for title and body placeholders (every slide inherits it) and the placeholder's
   * own levels for date, footer and number. Runs in the range lose the marks the style now carries, so they show it. With no
   * range every paragraph (so every level the placeholder shows) takes the change.
   */
  formatTemplateText(owner: string, id: string, patch: MarksPatch, range?: TextRange): void {
    this.#requireTemplate(owner, id);
    this.transact(this.#templateOps(owner, [id], () => ({ marks: patch }), range));
  }

  /** The same for paragraph properties: alignment, bullets, indents, spacing. `level` is not a style: it moves the paragraph itself. A function gives each paragraph its own patch. */
  formatTemplateParagraphs(owner: string, id: string, patch: ParaPatch | ((index: number, paragraph: Paragraph) => ParaPatch), range?: TextRange): void {
    this.#requireTemplate(owner, id);
    this.transact(this.#templateOps(owner, [id], (i, p) => ({ para: typeof patch === "function" ? patch(i, p) : patch }), range));
  }

  #requireTemplate(owner: string, id: string): void {
    if (!this.isTemplateText(owner, id)) throw new PliError("invalid_operation", "Only placeholders of a layout or master have text styles");
  }

  #templateOps(owner: string, ids: readonly string[], edit: (index: number, paragraph: Paragraph) => { marks?: MarksPatch; para?: ParaPatch }, range?: TextRange): DeckOp[] {
    const master = this.deck.masters.find((m) => m.id === owner);
    let textStyles = master?.textStyles;
    const ops: DeckOp[] = [];
    for (const id of ids) {
      const el = this.element(owner, id);
      if (el.type !== "shape" || !el.placeholder) continue;
      const family = placeholderFamily(el.placeholder.type);
      const key = master && (family === "title" || family === "body") ? family : null;
      const ps = el.text?.paragraphs.length ? el.text.paragraphs : [{ runs: [] } as Paragraph];
      const r = range ? ordered(range) : null;
      const own: Record<number, LevelStyle> = { ...el.text?.levels };
      const shared: Record<number, LevelStyle> | null = key && textStyles ? { ...textStyles[key] } : null;
      const next = ps.map((p, i) => {
        if (r && (i < r.from.p || i > r.to.p)) return p;
        const e = edit(i, p);
        const { level: newLevel, ...paraPatch } = (e.para ?? {}) as ParaPatch & { level?: number | null };
        const markKeys = Object.keys(e.marks ?? {});
        const paraKeys = Object.keys(paraPatch);
        const lv = clampLevel(p);
        const hasStyle = markKeys.length > 0 || paraKeys.length > 0;
        if (hasStyle) {
          if (shared) {
            shared[lv] = updatedLevel(shared[lv], e.marks, paraPatch);
            // what the placeholder's own levels say would hide the master style from slides
            if (own[lv]) {
              const rest = withoutKeys(own[lv]!, markKeys, paraKeys);
              if (Object.keys(rest).length) own[lv] = rest;
              else delete own[lv];
            }
          } else own[lv] = updatedLevel(own[lv], e.marks, paraPatch);
        }
        let out: Paragraph = p;
        if (markKeys.length) {
          const nullMarks = Object.fromEntries(markKeys.map((k) => [k, null])) as MarksPatch;
          const whole = { from: { p: 0, o: 0 }, to: { p: 0, o: p.runs.reduce((n, run) => n + run.text.length, 0) } };
          out = applyMarks([out], whole, nullMarks)[0]!;
          if (out.endMarks) {
            const end: Record<string, unknown> = { ...out.endMarks };
            for (const k of markKeys) delete end[k];
            out = { ...out };
            if (Object.keys(end).length) out.endMarks = end as Marks;
            else delete out.endMarks;
          }
        }
        if (paraKeys.length || newLevel !== undefined) {
          const rest: Record<string, unknown> = { ...out };
          for (const k of paraKeys) delete rest[k];
          out = rest as unknown as Paragraph;
          if (newLevel !== undefined) out = setParagraphProps([out], { from: { p: 0, o: 0 }, to: { p: 0, o: 0 } }, { level: newLevel })[0]!;
        }
        return out;
      });
      if (shared && textStyles && key) textStyles = { ...textStyles, [key]: shared };
      const hasOwn = Object.keys(own).length > 0;
      const text: TextBody = { ...el.text, paragraphs: next };
      if (hasOwn) text.levels = own;
      else delete text.levels;
      ops.push({ type: "replace_element", owner, element: { ...el, text } });
    }
    if (master && textStyles && textStyles !== master.textStyles) ops.unshift({ type: "patch_master", id: master.id, patch: { textStyles } });
    return ops;
  }

  /** Sets (or with `undefined` clears) the fill of shapes. */
  setFill(owner: string, ids: readonly string[], fill: Fill | null | undefined): void {
    this.updateElements(owner, ids, (e) => {
      if (e.type === "shape") {
        const { fill: _f, ...rest } = e;
        return (fill === undefined ? rest : { ...rest, fill }) as Element;
      }
      if (e.type === "table") return e;
      return e;
    });
  }

  setLine(owner: string, ids: readonly string[], line: ShapeElement["line"] | undefined): void {
    this.updateElements(owner, ids, (e) => {
      if (e.type === "shape" || e.type === "image") {
        const { line: _l, ...rest } = e;
        return (line === undefined ? rest : { ...rest, line }) as Element;
      }
      return e;
    });
  }

  setCrop(owner: string, id: string, crop: Crop | null): void {
    this.updateElement(owner, id, (e) => {
      if (e.type !== "image") return e;
      const { crop: _c, ...rest } = e;
      return crop ? { ...rest, crop } : rest;
    });
  }

  deleteElements(owner: string, ids: readonly string[]): void {
    const top = this.elementsOf(owner);
    const ops: DeckOp[] = [];
    const onSlide = this.deck.slides.some((s) => s.id === owner);
    for (const id of ids) {
      const found = top.find((e) => e.id === id);
      if (found && onSlide && found.type === "image" && found.placeholder) {
        // deleting the picture in a picture placeholder gives back the empty placeholder, as PowerPoint does
        ops.push({ type: "replace_element", owner, element: { type: "shape", id, geometry: "rect", placeholder: found.placeholder, text: { paragraphs: [{ runs: [] }] } } });
      } else if (found) ops.push({ type: "remove_element", owner, id });
      else {
        // inside a group: rewrite the group without it
        const strip = (list: Element[]): Element[] => list.filter((e) => e.id !== id).map((e) => (e.type === "group" ? { ...e, children: strip(e.children) } : e));
        ops.push({ type: "set_elements", owner, elements: strip(this.elementsOf(owner)) });
      }
    }
    this.transact(ops, { after: { slide: this.selection.slide, elements: [] } });
    this.selection = { ...this.selection, elements: [] };
  }

  /**
   * Puts a picture into a placeholder (usually a picture placeholder): the picture takes the placeholder's place and
   * shape, scaled to cover its frame and cropped to fit (as PowerPoint and Google Slides do), and stays linked to the layout.
   * `natural` is the picture's own size in any unit. Returns the new picture's id.
   */
  fillPlaceholderWithPicture(owner: string, id: string, src: string, natural: { w: number; h: number }, extra: Partial<ImageElement> = {}): string {
    const old = this.element(owner, id);
    if ((old.type !== "shape" && old.type !== "image") || !old.placeholder) throw new PliError("invalid_operation", "Not a placeholder");
    const frame = this.frames(owner).get(id);
    if (!frame) throw new PliError("not_found", `No element "${id}"`);
    const scene = this.scene(owner).elements.find((r) => r.id === id);
    const frameAspect = frame.w / (frame.h || 1);
    const picAspect = natural.w / (natural.h || 1);
    let crop: Crop | undefined;
    if (Math.abs(frameAspect - picAspect) > 0.001) {
      if (picAspect > frameAspect) {
        const side = (1 - frameAspect / picAspect) / 2;
        crop = { l: side, r: side };
      } else {
        const side = (1 - picAspect / frameAspect) / 2;
        crop = { t: side, b: side };
      }
    }
    const el: ImageElement = {
      type: "image",
      id: newId("e_"),
      src,
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      placeholder: { ...old.placeholder },
      ...(crop ? { crop } : {}),
      ...(scene?.custom ? { custom: scene.custom, geometry: "custom" } : scene && scene.geometry !== "rect" && scene.geometry !== "custom" ? { geometry: scene.geometry } : {}),
      ...(old.rotation ? { rotation: old.rotation } : {}),
      ...extra,
    };
    const elements = this.elementsOf(owner).map((e) => (e.id === id ? el : e));
    const ops: DeckOp[] = [{ type: "set_elements", owner, elements }];
    const slide = this.deck.slides.find((s) => s.id === owner);
    if (slide?.animations?.some((a) => a.target === id)) ops.push({ type: "patch_slide", id: owner, patch: { animations: slide.animations.map((a) => (a.target === id ? { ...a, target: el.id } : a)) } });
    this.transact(ops, { after: { slide: this.selection.slide, elements: [el.id] } });
    this.selection = { ...this.selection, elements: [el.id] };
    return el.id;
  }

  /** Copies elements in place, a little offset. Returns the copies' ids. */
  duplicateElements(owner: string, ids: readonly string[], offset = 12): string[] {
    const frames = this.frames(owner);
    const copies = ids.map((id) => shifted(withNewIds(this.element(owner, id)), offset, offset, frames));
    const owned = this.deck.slides.find((s) => s.id === owner);
    // `shifted` reads frames by id, so the copies (new ids) were shifted without a base: set from the originals
    const fixed = copies.map((c, i) => {
      const f = frames.get(ids[i]!);
      return f && c.x === undefined ? ({ ...c, x: f.x + offset, y: f.y + offset, w: f.w, h: f.h } as Element) : c;
    });
    const map = new Map(ids.map((id, i) => [id, fixed[i]!.id] as const));
    return this.insertElements(owner, fixed, owned ? remapAnimations(owned.animations ?? [], map, newId) : []);
  }

  copyElements(owner: string, ids: readonly string[]): ElementClip {
    const frames = this.frames(owner);
    const elements = ids.map((id) => { const e = clone(this.element(owner, id)); const f = frames.get(id); return f ? ({ ...e, ...f } as Element) : e; });
    const animations = clone((this.deck.slides.find((s) => s.id === owner)?.animations ?? []).filter((a) => ids.includes(a.target)));
    return { format: "pli.deck.elements", elements, ...(animations.length ? { animations } : {}) };
  }

  /** Pastes copied elements into an owner (new ids). Returns their ids. */
  pasteElements(owner: string, clip: ElementClip, offset = 0): string[] {
    const map = new Map<string, string>();
    const fresh = clip.elements.map((e) => {
      const n = withNewIds(e);
      map.set(e.id, n.id);
      return offset ? shifted(n, offset, offset, new Map()) : n;
    });
    return this.insertElements(owner, fresh, remapAnimations(clip.animations ?? [], map, newId));
  }

  arrange(owner: string, ids: readonly string[], how: Arrange): void {
    const list = this.elementsOf(owner);
    const selected = list.filter((e) => ids.includes(e.id));
    if (selected.length === 0) return;
    let order: Element[];
    const rest = list.filter((e) => !ids.includes(e.id));
    if (how === "front") order = [...rest, ...selected];
    else if (how === "back") order = [...selected, ...rest];
    else {
      order = [...list];
      const idxs = selected.map((e) => order.indexOf(e));
      if (how === "forward") {
        for (const i of [...idxs].sort((a, b) => b - a)) if (i < order.length - 1 && !ids.includes(order[i + 1]!.id)) [order[i], order[i + 1]] = [order[i + 1]!, order[i]!];
      } else for (const i of [...idxs].sort((a, b) => a - b)) if (i > 0 && !ids.includes(order[i - 1]!.id)) [order[i], order[i - 1]] = [order[i - 1]!, order[i]!];
    }
    const ops: DeckOp[] = [];
    const cur = [...list];
    order.forEach((e, i) => {
      const from = cur.indexOf(e);
      if (from !== i) {
        ops.push({ type: "move_element", owner, id: e.id, index: i });
        cur.splice(from, 1);
        cur.splice(i, 0, e);
      }
    });
    if (ops.length) this.transact(ops);
  }

  /** Aligns elements to each other (two or more selected) or to the slide. */
  align(owner: string, ids: readonly string[], how: AlignTo, to: "selection" | "slide" = ids.length > 1 ? "selection" : "slide"): void {
    const frames = this.frames(owner);
    const boxes = ids.map((id) => frames.get(id)).filter((b): b is Box => !!b);
    if (boxes.length === 0) return;
    const ref: Box = to === "slide" ? { x: 0, y: 0, w: this.deck.size.width, h: this.deck.size.height } : boundsOf(boxes);
    const updates: Record<string, Partial<Box>> = {};
    for (const id of ids) {
      const b = frames.get(id);
      if (!b) continue;
      if (how === "left") updates[id] = { x: ref.x };
      else if (how === "center") updates[id] = { x: ref.x + (ref.w - b.w) / 2 };
      else if (how === "right") updates[id] = { x: ref.x + ref.w - b.w };
      else if (how === "top") updates[id] = { y: ref.y };
      else if (how === "middle") updates[id] = { y: ref.y + (ref.h - b.h) / 2 };
      else updates[id] = { y: ref.y + ref.h - b.h };
    }
    this.#moveTo(owner, updates);
  }

  /** Spaces three or more elements evenly. */
  distribute(owner: string, ids: readonly string[], axis: "horizontal" | "vertical"): void {
    const frames = this.frames(owner);
    const items = ids.map((id) => ({ id, b: frames.get(id)! })).filter((i) => i.b);
    if (items.length < 3) return;
    const h = axis === "horizontal";
    items.sort((a, b) => (h ? a.b.x - b.b.x : a.b.y - b.b.y));
    const first = items[0]!.b;
    const last = items[items.length - 1]!.b;
    const total = items.reduce((n, i) => n + (h ? i.b.w : i.b.h), 0);
    const span = h ? last.x + last.w - first.x : last.y + last.h - first.y;
    const gap = (span - total) / (items.length - 1);
    let at = h ? first.x : first.y;
    const updates: Record<string, Partial<Box>> = {};
    for (const i of items) {
      updates[i.id] = h ? { x: at } : { y: at };
      at += (h ? i.b.w : i.b.h) + gap;
    }
    this.#moveTo(owner, updates);
  }

  #moveTo(owner: string, updates: Record<string, Partial<Box>>): void {
    const frames = this.frames(owner);
    const ops: DeckOp[] = [];
    for (const [id, u] of Object.entries(updates)) {
      const e = this.element(owner, id);
      const b = frames.get(id)!;
      const dx = (u.x ?? b.x) - b.x;
      const dy = (u.y ?? b.y) - b.y;
      if (dx || dy) ops.push({ type: "replace_element", owner, element: shifted(e, dx, dy, frames) });
    }
    this.transact(ops);
  }

  /** Groups top-level elements; the group goes where the topmost of them was. Returns the group's id. */
  group(owner: string, ids: readonly string[]): string | null {
    const list = this.elementsOf(owner);
    const members = list.filter((e) => ids.includes(e.id));
    if (members.length < 2) return null;
    const frames = this.frames(owner);
    const box = boundsOf(members.map((m) => frames.get(m.id)!));
    const children = members.map((m) => ({ ...m, ...frames.get(m.id) }) as Element);
    const g: GroupElement = { type: "group", id: newId("e_"), ...box, children };
    const at = list.lastIndexOf(members[members.length - 1]!) - (members.length - 1);
    const rest = list.filter((e) => !ids.includes(e.id));
    const elements = [...rest.slice(0, at), g, ...rest.slice(at)];
    const ops: DeckOp[] = [{ type: "set_elements", owner, elements }];
    // what is animated inside a group is animated as the group: the first member's animations move to it, the others' go
    const slide = this.deck.slides.find((s) => s.id === owner);
    if (slide?.animations?.some((a) => ids.includes(a.target))) {
      const lead = slide.animations.find((a) => ids.includes(a.target))!.target;
      const animations = slide.animations.filter((a) => !ids.includes(a.target) || a.target === lead).map((a) => (a.target === lead ? { ...a, target: g.id } : a));
      ops.push({ type: "patch_slide", id: slide.id, patch: { animations: animations.length ? animations : null } });
    }
    this.transact(ops, { after: { slide: this.selection.slide, elements: [g.id] } });
    this.selection = { ...this.selection, elements: [g.id] };
    return g.id;
  }

  ungroup(owner: string, id: string): string[] {
    const list = this.elementsOf(owner);
    const g = list.find((e) => e.id === id);
    if (!g || g.type !== "group") return [];
    const at = list.indexOf(g);
    const elements = [...list.slice(0, at), ...g.children, ...list.slice(at + 1)];
    this.transact([{ type: "set_elements", owner, elements }], { after: { slide: this.selection.slide, elements: g.children.map((c) => c.id) } });
    this.selection = { ...this.selection, elements: g.children.map((c) => c.id) };
    return g.children.map((c) => c.id);
  }


  // ---- Tables ---------------------------------------------------------------------------------------------------

  #table(owner: string, id: string): TableElement {
    const el = this.element(owner, id);
    if (el.type !== "table") throw new PliError("invalid_operation", "Not a table");
    return el;
  }

  #setTable(owner: string, el: TableElement): void {
    const h = el.rows.reduce((n, r) => n + r.h, 0);
    const w = el.columns.reduce((n, c) => n + c, 0);
    this.transact([{ type: "replace_element", owner, element: { ...el, w, h } }]);
  }

  /** Inserts `count` rows so that the first has index `at` (0 puts it on top, the row count at the bottom). */
  insertTableRows(owner: string, id: string, at: number, count = 1): void {
    const el = this.#table(owner, id);
    const index = Math.max(0, Math.min(at, el.rows.length));
    const ref = el.rows[Math.min(Math.max(index - 1, 0), el.rows.length - 1)]!;
    const rows = el.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) }));
    const made: TableRow[] = [];
    for (let n = 0; n < count; n++) {
      const bumped = new Set<string>();
      made.push({
        h: ref.h,
        cells: el.columns.map((_, c) => {
          // a row slipped into the middle of a vertical merge becomes part of it
          const covered = index > 0 && index < rows.length && !!rows[index]!.cells[c]!.covered ? originOfCell(rows, index, c) : undefined;
          if (covered && covered.r < index) {
            const key = `${covered.r},${covered.c}`;
            if (!bumped.has(key)) {
              bumped.add(key);
              rows[covered.r]!.cells[covered.c]!.rowSpan = (rows[covered.r]!.cells[covered.c]!.rowSpan ?? 1) + 1;
            }
            return { paragraphs: [{ runs: [] }], covered: true as const };
          }
          return { paragraphs: [{ runs: [] }] };
        }),
      });
    }
    rows.splice(index, 0, ...made);
    this.#setTable(owner, { ...el, rows });
  }

  /** Deletes `count` rows from `from` on (never all of them). */
  deleteTableRows(owner: string, id: string, from: number, count = 1): void {
    const el = this.#table(owner, id);
    let rows: TableRow[] = el.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) }));
    for (let n = 0; n < count; n++) {
      if (rows.length <= 1 || from >= rows.length) break;
      const r = from;
      const shrunk = new Set<string>();
      rows[r]!.cells.forEach((cell, c) => {
        if (cell.covered) {
          const o = originOfCell(rows, r, c);
          if (o && o.r < r && !shrunk.has(`${o.r},${o.c}`)) {
            shrunk.add(`${o.r},${o.c}`);
            rows[o.r]!.cells[o.c]!.rowSpan = Math.max(1, (rows[o.r]!.cells[o.c]!.rowSpan ?? 1) - 1);
          }
        } else if ((cell.rowSpan ?? 1) > 1 && rows[r + 1]) {
          // the merged cell continues on the next row
          const below = rows[r + 1]!.cells[c]!;
          const moved: TableCell = { ...cell, rowSpan: (cell.rowSpan ?? 1) - 1 };
          if (moved.rowSpan === 1) delete moved.rowSpan;
          void below;
          rows[r + 1]!.cells[c] = moved;
        }
      });
      rows = rows.filter((_, i) => i !== r);
    }
    this.#setTable(owner, { ...el, rows });
  }

  /** Inserts `count` columns so that the first has index `at`. */
  insertTableColumns(owner: string, id: string, at: number, count = 1): void {
    const el = this.#table(owner, id);
    const index = Math.max(0, Math.min(at, el.columns.length));
    const width = el.columns[Math.min(Math.max(index - 1, 0), el.columns.length - 1)]!;
    const rows = el.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) }));
    const grow = new Map<TableCell, number>();
    rows.forEach((row, ri) => {
      const added: TableCell[] = [];
      for (let n = 0; n < count; n++) {
        const o = index > 0 && index < row.cells.length && row.cells[index]!.covered ? originOfCell(rows, ri, index) : undefined;
        if (o && o.c < index) {
          const origin = rows[o.r]!.cells[o.c]!;
          grow.set(origin, (grow.get(origin) ?? 0) + 1);
          added.push({ paragraphs: [{ runs: [] }], covered: true });
        } else added.push({ paragraphs: [{ runs: [] }] });
      }
      row.cells.splice(index, 0, ...added);
    });
    for (const [cell, n] of grow) cell.colSpan = (cell.colSpan ?? 1) + n / Math.max(1, cell.rowSpan ?? 1);
    const columns = [...el.columns];
    columns.splice(index, 0, ...Array.from({ length: count }, () => width));
    this.#setTable(owner, { ...el, columns, rows });
  }

  /** Deletes `count` columns from `from` on (never all of them). */
  deleteTableColumns(owner: string, id: string, from: number, count = 1): void {
    const el = this.#table(owner, id);
    const rows: TableRow[] = el.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) }));
    const columns = [...el.columns];
    for (let n = 0; n < count; n++) {
      if (columns.length <= 1 || from >= columns.length) break;
      const c = from;
      rows.forEach((row, ri) => {
        const cell = row.cells[c]!;
        if (cell.covered) {
          const o = originOfCell(rows, ri, c);
          // count each merged cell once: only on the origin's own row
          if (o && o.c < c && o.r === ri) rows[o.r]!.cells[o.c]!.colSpan = Math.max(1, (rows[o.r]!.cells[o.c]!.colSpan ?? 1) - 1);
        } else if ((cell.colSpan ?? 1) > 1 && row.cells[c + 1]) {
          row.cells[c + 1] = { ...cell, colSpan: (cell.colSpan ?? 1) - 1 };
          delete row.cells[c + 1]!.covered;
        }
        row.cells.splice(c, 1);
      });
      columns.splice(c, 1);
    }
    this.#setTable(owner, { ...el, columns, rows });
  }

  /** Merges the cells of a block (grown to take in whole merged cells) into one; their text joins in reading order. */
  mergeCells(owner: string, id: string, block: { r1: number; c1: number; r2: number; c2: number }): void {
    const el = this.#table(owner, id);
    let { r1, c1, r2, c2 } = { r1: Math.min(block.r1, block.r2), c1: Math.min(block.c1, block.c2), r2: Math.max(block.r1, block.r2), c2: Math.max(block.c1, block.c2) };
    const rows: TableRow[] = el.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) }));
    r2 = Math.min(r2, rows.length - 1);
    c2 = Math.min(c2, el.columns.length - 1);
    for (let again = true; again; ) {
      again = false;
      for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++) {
          const o = originOfCell(rows, r, c);
          if (!o) continue;
          const cell = rows[o.r]!.cells[o.c]!;
          const er = o.r + (cell.rowSpan ?? 1) - 1;
          const ec = o.c + (cell.colSpan ?? 1) - 1;
          if (o.r < r1 || o.c < c1 || er > r2 || ec > c2) {
            r1 = Math.min(r1, o.r);
            c1 = Math.min(c1, o.c);
            r2 = Math.max(r2, er);
            c2 = Math.max(c2, ec);
            again = true;
          }
        }
    }
    if (r1 === r2 && c1 === c2) return;
    const origin = rows[r1]!.cells[c1]!;
    const merged: Paragraph[] = [...origin.paragraphs];
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++) {
        if (r === r1 && c === c1) continue;
        const cell = rows[r]!.cells[c]!;
        if (!cell.covered && cell.paragraphs.some((p) => paragraphText(p) !== "")) {
          if (merged.length === 1 && paragraphText(merged[0]!) === "") merged.splice(0, 1, ...cell.paragraphs);
          else merged.push(...cell.paragraphs);
        }
        rows[r]!.cells[c] = { paragraphs: [{ runs: [] }], covered: true };
      }
    origin.paragraphs = merged;
    origin.colSpan = c2 - c1 + 1;
    origin.rowSpan = r2 - r1 + 1;
    delete origin.covered;
    this.#setTable(owner, { ...el, rows });
  }

  /** Splits a merged cell back into single cells. */
  unmergeCells(owner: string, id: string, row: number, col: number): void {
    const el = this.#table(owner, id);
    const rows: TableRow[] = el.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) }));
    const o = originOfCell(rows, row, col);
    if (!o) return;
    const origin = rows[o.r]!.cells[o.c]!;
    const rs = origin.rowSpan ?? 1;
    const cs = origin.colSpan ?? 1;
    if (rs === 1 && cs === 1) return;
    for (let r = o.r; r < o.r + rs; r++) for (let c = o.c; c < o.c + cs; c++) if (r !== o.r || c !== o.c) rows[r]!.cells[c] = { paragraphs: [{ runs: [] }] };
    delete origin.rowSpan;
    delete origin.colSpan;
    this.#setTable(owner, { ...el, rows });
  }

  /** Sets fill, vertical alignment or borders on table cells (`[row, col]` pairs). A `null` fill clears it. */
  setTableCells(owner: string, id: string, cells: readonly (readonly [number, number])[], patch: Partial<Pick<TableCell, "fill" | "vAlign" | "borders">>): void {
    const el = this.#table(owner, id);
    const keys = new Set(cells.map(([r, c]) => `${r},${c}`));
    const rows = el.rows.map((row, ri) => ({
      ...row,
      cells: row.cells.map((cell, ci) => {
        if (!keys.has(`${ri},${ci}`)) return cell;
        const next: TableCell = { ...cell };
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
          else (next as unknown as Record<string, unknown>)[k] = k === "borders" ? { ...cell.borders, ...(v as object) } : v;
        }
        return next;
      }),
    }));
    this.#setTable(owner, { ...el, rows });
  }

  /** Marks the first row as a header and/or shades alternate rows. */
  setTableOptions(owner: string, id: string, options: { headerRow?: boolean; banded?: boolean }): void {
    const el = this.#table(owner, id);
    this.transact([{ type: "replace_element", owner, element: { ...el, ...options } }]);
  }

  // ---- Animations -----------------------------------------------------------------------------------------------

  /** The animations of a slide, in the order they run. */
  animations(slideId: string): Animation[] {
    return this.slide(slideId).animations ?? [];
  }

  /** Replaces a slide's whole list of animations. */
  setAnimations(slideId: string, list: readonly Animation[], options: TransactOptions<DeckSelection> = {}): void {
    const slide = this.slide(slideId);
    const ids = new Set(slide.elements.map((e) => e.id));
    const seen = new Set<string>();
    for (const a of list) {
      const problem = animationProblem(a);
      if (problem) throw new PliError("invalid_operation", `Animation "${a.id}": ${problem}`);
      if (!ids.has(a.target)) throw new PliError("not_found", `No element "${a.target}" on this slide to animate`);
      if (seen.has(a.id)) throw new PliError("invalid_operation", `Two animations have the id "${a.id}"`);
      seen.add(a.id);
    }
    this.transact([{ type: "patch_slide", id: slideId, patch: { animations: list.length ? [...list] : null } }], options);
  }

  /** Adds an animation (at the end of the timeline, or at `index`). Returns it. */
  addAnimation(slideId: string, input: AnimationInput, index?: number): Animation {
    const list = [...this.animations(slideId)];
    const a = makeAnimation(input, newId("a_"));
    list.splice(index === undefined ? list.length : Math.max(0, Math.min(list.length, index)), 0, a);
    this.setAnimations(slideId, list);
    return a;
  }

  /** Changes an animation's settings; a field set to `null` goes back to its default. */
  updateAnimation(slideId: string, id: string, patch: { [K in keyof Animation]?: Animation[K] | null }, options: TransactOptions<DeckSelection> = {}): void {
    const list = this.animations(slideId);
    if (!list.some((a) => a.id === id)) throw new PliError("not_found", `No animation "${id}"`);
    this.setAnimations(
      slideId,
      list.map((a) => {
        if (a.id !== id) return a;
        const next: Record<string, unknown> = { ...a };
        for (const [k, v] of Object.entries(patch)) {
          if (k === "id") continue;
          if (v === null || v === undefined) delete next[k];
          else next[k] = v;
        }
        return next as unknown as Animation;
      }),
      options,
    );
  }

  removeAnimations(slideId: string, ids: readonly string[]): void {
    this.setAnimations(slideId, this.animations(slideId).filter((a) => !ids.includes(a.id)));
  }

  /** Moves an animation earlier or later in the timeline (to an index, or one place up or down). */
  moveAnimation(slideId: string, id: string, to: number | "up" | "down"): void {
    const list = [...this.animations(slideId)];
    const at = list.findIndex((a) => a.id === id);
    if (at < 0) throw new PliError("not_found", `No animation "${id}"`);
    const index = to === "up" ? at - 1 : to === "down" ? at + 1 : to;
    if (index === at || index < 0 || index >= list.length) return;
    const [a] = list.splice(at, 1);
    list.splice(index, 0, a!);
    this.setAnimations(slideId, list);
  }

  /** Keeps the animations of slides tied to elements that exist: anything that removes an element takes its animations along. */
  #withAnimationCleanup(ops: readonly DeckOp[]): readonly DeckOp[] {
    const d = this.deck;
    const touches = ops.some((o) => (o.type === "patch_slide" && o.patch.animations) || (o.type === "insert_slide" && o.slide.animations));
    if (!touches && !d.slides.some((s) => s.animations?.length)) return ops;
    let state = d;
    try {
      for (const op of ops) state = deckReducer.apply(state, op).state;
    } catch {
      return ops; // the real run reports what is wrong
    }
    const extra: DeckOp[] = [];
    for (const s of state.slides) {
      if (!s.animations) continue;
      const kept = pruneAnimations(s);
      if (kept !== s) extra.push({ type: "patch_slide", id: s.id, patch: { animations: kept.animations ?? null } });
    }
    return extra.length ? [...ops, ...extra] : ops;
  }

  /** Sets column widths and/or row heights (a drag of a border). */
  setTableSizes(owner: string, id: string, sizes: { columns?: number[]; rows?: number[] }, options: TransactOptions<DeckSelection> = {}): void {
    const el = this.#table(owner, id);
    const columns = sizes.columns ?? el.columns;
    const rows = sizes.rows ? el.rows.map((r, i) => ({ ...r, h: sizes.rows![i] ?? r.h })) : el.rows;
    const w = columns.reduce((n, c) => n + c, 0);
    const h = rows.reduce((n, r) => n + r.h, 0);
    this.transact([{ type: "replace_element", owner, element: { ...el, columns, rows, w, h } }], options);
  }

  // ---- Themes and layouts ---------------------------------------------------------------------------------------

  /**
   * Switches the deck to another master (a theme with its layouts, such as one from `themes` or from an imported
   * template). Slides move to the new master's layout of the same kind (or name); the old masters go if nothing uses them.
   */
  applyTheme(master: Master, options: { keepOthers?: boolean } = {}): void {
    const d = this.deck;
    const fresh: Master = clone(master);
    // fresh ids so the same theme can be applied twice without clashing
    const idMap = new Map<string, string>();
    fresh.id = newId("m_");
    fresh.layouts.forEach((l) => {
      const nid = newId("l_");
      idMap.set(l.id, nid);
      l.id = nid;
    });
    const ops: DeckOp[] = [{ type: "insert_master", master: fresh, index: 0 }];
    for (const s of d.slides) {
      const old = findLayout(d, s.layout)?.layout;
      // a layout that has a place for each of the slide's placeholders; failing that, the one with the most
      const slots = s.elements.filter((e): e is ShapeElement => e.type === "shape" && !!e.placeholder && !["dt", "ftr", "sldNum"].includes(e.placeholder.type));
      const fit = (l: Layout) => slots.filter((e) => l.elements.some((x) => x.type === "shape" && x.placeholder && placeholderFamily(x.placeholder.type) === placeholderFamily(e.placeholder!.type))).length;
      const whole = (l: Layout) => fit(l) === slots.length;
      // among equals, a cover layout is for cover slides only, and a layout of the same kind beats one of another
      const rank = (l: Layout) => fit(l) * 10 + (old && l.kind === old.kind ? 5 : 0) + (l.kind !== "title" || old?.kind === "title" ? 1 : 0);
      const target =
        fresh.layouts.find((l) => old && old.kind && old.kind !== "custom" && l.kind === old.kind && whole(l)) ??
        fresh.layouts.find((l) => old && l.name.toLowerCase() === old.name.toLowerCase() && whole(l)) ??
        fresh.layouts.find((l) => l.kind === "titleAndBody" && whole(l)) ??
        fresh.layouts.find((l) => whole(l) && fit(l) > 0) ??
        fresh.layouts.reduce<Layout | undefined>((best, l) => (best === undefined || rank(l) > rank(best) ? l : best), undefined) ??
        fresh.layouts[0]!;
      ops.push({ type: "patch_slide", id: s.id, patch: { layout: target.id } });
    }
    if (!options.keepOthers) for (const m of d.masters) ops.push({ type: "remove_master", id: m.id });
    this.transact(ops);
  }

  /** Replaces a theme's colours (the colour scheme) and/or fonts. */
  setTheme(masterId: string, patch: Partial<Theme>, options: TransactOptions<DeckSelection> = {}): void {
    const m = this.deck.masters.find((x) => x.id === masterId);
    if (!m) throw new PliError("not_found", `No master "${masterId}"`);
    this.transact([{ type: "patch_master", id: masterId, patch: { theme: { ...m.theme, ...patch, colors: { ...m.theme.colors, ...patch.colors }, fonts: { ...m.theme.fonts, ...patch.fonts } } } }], options);
  }

  patchMaster(id: string, patch: MasterPatch): void {
    this.transact([{ type: "patch_master", id, patch }]);
  }
  patchLayout(id: string, patch: LayoutPatch): void {
    this.transact([{ type: "patch_layout", id, patch }]);
  }

  addLayout(masterId: string, name: string, kind: LayoutKind = "custom", from?: string): Layout {
    const src = from ? this.layout(from).layout : undefined;
    const layout: Layout = { id: newId("l_"), name, kind, elements: src ? src.elements.map(withNewIds) : [] };
    this.transact([{ type: "insert_layout", master: masterId, layout }]);
    return layout;
  }
  removeLayout(id: string): void {
    this.transact([{ type: "remove_layout", id }]);
  }

  /** A copy of a layout (placeholders, decorations, background, kind) right after the original, with new ids. */
  duplicateLayout(id: string): Layout {
    const { master, layout } = this.layout(id);
    const copy: Layout = { ...clone(layout), id: newId("l_"), name: `${layout.name} copy`, elements: layout.elements.map(withNewIds) };
    this.transact([{ type: "insert_layout", master: master.id, layout: copy, index: master.layouts.indexOf(layout) + 1 }]);
    return copy;
  }

  /** Moves a layout up or down among its master's layouts, or to an index. Does nothing at the ends. */
  moveLayout(id: string, to: "up" | "down" | number): void {
    const { master, layout } = this.layout(id);
    const at = master.layouts.indexOf(layout);
    const index = to === "up" ? at - 1 : to === "down" ? at + 1 : to;
    if (index === at || index < 0 || index >= master.layouts.length) return;
    this.transact([{ type: "move_layout", id, index }]);
  }

  /** Renames a master. */
  renameMaster(id: string, name: string): void {
    const n = name.trim();
    if (!n) throw new PliError("invalid_operation", "A master needs a name");
    this.patchMaster(id, { name: n });
  }

  /** Adds a master (a built-in theme's, an imported one…) to the deck with fresh ids, after the others. Slides keep the layouts they have. */
  addMaster(master: Master, options: { index?: number } = {}): Master {
    const fresh = withFreshIds(master);
    fresh.name = freeName(this.deck, fresh.name || "Master");
    this.transact([{ type: "insert_master", master: fresh, ...(options.index !== undefined ? { index: options.index } : {}) }]);
    return fresh;
  }

  /** A copy of a master with all its layouts, right after the original. */
  duplicateMaster(id: string): Master {
    const src = this.deck.masters.find((m) => m.id === id);
    if (!src) throw new PliError("not_found", `No master "${id}"`);
    const fresh = withFreshIds(src);
    fresh.name = freeName(this.deck, `${src.name} copy`);
    this.transact([{ type: "insert_master", master: fresh, index: this.deck.masters.indexOf(src) + 1 }]);
    return fresh;
  }

  /** Removes a master, when no slide uses its layouts and another master remains. */
  removeMaster(id: string): void {
    this.transact([{ type: "remove_master", id }]);
  }

  /**
   * Gives the placeholders a person styles through their prompt text: a master title says "Click to edit Master title style" and
   * body placeholders show five paragraphs at levels 0 to 4 ("Second level"…), so each level can be edited. Returns whether
   * anything changed. Placeholders that have text are left alone; slides are never touched.
   */
  addLevelPrompts(masterId?: string): boolean {
    const ops: DeckOp[] = [];
    for (const m of masterId ? this.deck.masters.filter((x) => x.id === masterId) : this.deck.masters) {
      const next = withLevelPrompts(m);
      if (next === m) continue;
      if (next.elements !== m.elements && next.elements.some((e, i) => e !== m.elements[i])) ops.push({ type: "set_elements", owner: m.id, elements: next.elements });
      next.layouts.forEach((l, i) => {
        if (l !== m.layouts[i]) ops.push({ type: "set_elements", owner: l.id, elements: l.elements });
      });
    }
    if (ops.length) this.transact(ops);
    return ops.length > 0;
  }

  /**
   * Adds an empty placeholder to a layout or master (title, body text, subtitle, picture, date, footer or slide number), with a
   * default frame and the prompt text slides show. A layout can have one title, date, footer and number; their frames are inherited from the master's.
   */
  addPlaceholder(owner: string, type: PlaceholderType, box?: Partial<Box>): ShapeElement {
    const d = this.deck;
    const layoutFound = findLayout(d, owner);
    const master = layoutFound?.master ?? d.masters.find((m) => m.id === owner);
    if (!master) throw new PliError("not_found", `No layout or master "${owner}"`);
    const existing = this.elementsOf(owner).filter((e): e is ShapeElement => e.type === "shape" && !!e.placeholder);
    const family = placeholderFamily(type);
    const single = family === "title" || family === "dt" || family === "ftr" || family === "sldNum";
    if (single && existing.some((e) => placeholderFamily(e.placeholder!.type) === family)) {
      throw new PliError("invalid_operation", `This ${layoutFound ? "layout" : "master"} already has that placeholder`);
    }
    if (!layoutFound && !single && existing.some((e) => placeholderFamily(e.placeholder!.type) === family)) {
      throw new PliError("invalid_operation", "The master already has that placeholder");
    }
    const inheritedFrame = !!layoutFound && (family === "dt" || family === "ftr" || family === "sldNum") && !!matchPlaceholder(master.elements, { type });
    const masterIdx = layoutFound ? matchPlaceholder(master.elements, { type })?.placeholder?.idx : undefined;
    let idx: number | undefined;
    if (family === "dt" || family === "ftr" || family === "sldNum") idx = masterIdx ?? DEFAULT_IDX[type];
    else if (!single && layoutFound) idx = existing.reduce((n, e) => Math.max(n, e.placeholder!.idx ?? 0), 0) + 1;
    const isBody = type === "body" || type === "obj";
    const frame = inheritedFrame && !box ? {} : { ...placeholderBox(type, d.size), ...box };
    const text: TextBody =
      isBody ? { paragraphs: levelPromptParagraphs() }
      : !layoutFound && family === "title" ? { paragraphs: [{ runs: [{ text: MASTER_TITLE_PROMPT }] }] }
      : { paragraphs: [{ runs: [] }] };
    if (type === "subTitle") text.levels = { 0: { bullet: null, marL: 0, indent: 0 } };
    const el: ShapeElement = { type: "shape", id: newId("e_"), geometry: "rect", placeholder: idx === undefined ? { type } : { type, idx }, ...frame, text };
    this.transact([{ type: "insert_element", owner, element: el }]);
    return el;
  }

  // ---- Find and replace -----------------------------------------------------------------------------------------

  find(query: string, options: { matchCase?: boolean; notes?: boolean } = {}): FindHit[] {
    if (!query) return [];
    const hits: FindHit[] = [];
    const norm = (s: string) => (options.matchCase ? s : s.toLowerCase());
    const q = norm(query);
    const scan = (text: string, make: (offset: number) => FindHit) => {
      const t = norm(text);
      for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + q.length)) hits.push(make(i));
    };
    const visit = (slide: Slide, list: readonly Element[]) => {
      for (const e of list) {
        if (e.type === "shape" && e.text) e.text.paragraphs.forEach((p, pi) => scan(paragraphText(p), (offset) => ({ slide: slide.id, element: e.id, paragraph: pi, offset, length: query.length })));
        else if (e.type === "table") e.rows.forEach((r, ri) => r.cells.forEach((c, ci) => c.paragraphs.forEach((p, pi) => scan(paragraphText(p), (offset) => ({ slide: slide.id, element: e.id, cell: [ri, ci] as [number, number], paragraph: pi, offset, length: query.length })))));
        else if (e.type === "group") visit(slide, e.children);
      }
    };
    for (const s of this.deck.slides) {
      visit(s, s.elements);
      if (options.notes !== false) s.notes.split("\n").forEach((line, pi) => scan(line, (offset) => ({ slide: s.id, paragraph: pi, offset, length: query.length })));
    }
    return hits;
  }

  /** Replaces every match in slides' text and notes. Returns how many. */
  replaceAll(query: string, replacement: string, options: { matchCase?: boolean; notes?: boolean } = {}): number {
    const hits = this.find(query, options);
    if (hits.length === 0) return 0;
    const flags = options.matchCase ? "g" : "gi";
    const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    const swap = (ps: Paragraph[]): Paragraph[] => ps.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, text: r.text.replace(re, () => replacement) })) }));
    const ops: DeckOp[] = [];
    const visit = (owner: string, list: readonly Element[]): Element[] =>
      list.map((e) => {
        if (e.type === "shape" && e.text) return { ...e, text: { ...e.text, paragraphs: swap(e.text.paragraphs) } };
        if (e.type === "table") return { ...e, rows: e.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, paragraphs: swap(c.paragraphs) })) })) };
        if (e.type === "group") return { ...e, children: visit(owner, e.children) };
        return e;
      });
    for (const s of this.deck.slides) {
      const next = visit(s.id, s.elements);
      if (JSON.stringify(next) !== JSON.stringify(s.elements)) ops.push({ type: "set_elements", owner: s.id, elements: next });
      if (options.notes !== false && re.test(s.notes)) {
        re.lastIndex = 0;
        ops.push({ type: "patch_slide", id: s.id, patch: { notes: s.notes.replace(re, () => replacement) } });
      }
      re.lastIndex = 0;
    }
    this.transact(ops);
    return hits.length;
  }

  // ---- Files ----------------------------------------------------------------------------------------------------

  /** The deck as JSON text. */
  toJSON(): string {
    return JSON.stringify(this.deck);
  }
}

/** All the ids used by a deck's slides' elements (for tests and validation). */
export function allElementIds(deck: Deck): string[] {
  return deck.slides.flatMap((s) => elementIds(s.elements));
}

export { createId };
