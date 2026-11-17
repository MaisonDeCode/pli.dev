import { PliError, applyCommentChange, type CommentChange, type Reducer, type Thread } from "@pli.dev/core";
import type { Animation, Deck, DeckAnchor, Element, Fill, Layout, LayoutKind, Master, MasterTextStyles, LevelStyle, Paragraph, Slide, SlideSize, Theme, Transition } from "./model";
import { applyDelta, docToParagraphs, docToString, invertDelta, paragraphsToDoc, stringToDoc, type Delta } from "./delta";

/** What `patch_slide` can change. A field set to `null` is removed. */
export interface SlidePatch {
  layout?: string;
  name?: string | null;
  background?: Fill | null;
  notes?: string;
  transition?: Transition | null;
  animations?: Animation[] | null;
  skipped?: boolean | null;
  showMasterElements?: boolean | null;
}

export interface MasterPatch {
  name?: string;
  theme?: Theme;
  background?: Fill | null;
  textStyles?: MasterTextStyles;
}

export interface LayoutPatch {
  name?: string;
  kind?: LayoutKind | null;
  background?: Fill | null;
  showMasterElements?: boolean | null;
}

/**
 * Every change to a deck is one of these JSON operations. They are invertible, so history works, and serializable,
 * so they can be logged or sent. Elements are named by the id of what holds them (`owner`): a slide, layout or master.
 */
/**
 * What a `set_path` changes: an element (found by its id inside the slide, layout or master `owner`; `within` lists the
 * groups it is inside, outermost first, so merging knows when a group goes away), or a master or a layout.
 */
export type PathTarget = { owner: string; id: string; within?: string[] } | { master: string } | { layout: string };

/** A step into a value: a field name, or an index into a list. */
export type PathStep = string | number;

/**
 * Every change to a deck is one of these JSON operations. They are invertible, so history works, and serializable,
 * so they can be logged or sent. Elements are named by the id of what holds them (`owner`): a slide, layout or master.
 *
 * Operations that put things in a list say where with `index`, and those that take things out or move them say where
 * they were with `from`: that is what lets two people's changes to the same list be merged (see `deckSyncModel`). The
 * editing commands fill them in; the reducer needs only the ids.
 */
export type DeckOp =
  | { type: "set_deck"; patch: { title?: string; size?: SlideSize } }
  | { type: "insert_slide"; slide: Slide; index: number }
  | { type: "remove_slide"; id: string; from?: number }
  | { type: "move_slide"; id: string; index: number; from?: number }
  | { type: "patch_slide"; id: string; patch: SlidePatch }
  /** Puts an element on a slide, layout or master (at `index` among its elements; on top by default). */
  | { type: "insert_element"; owner: string; element: Element; index?: number }
  | { type: "remove_element"; owner: string; id: string; from?: number }
  /** Replaces the element with the same id, wherever it is (inside a group too). `within`: the groups it is inside. */
  | { type: "replace_element"; owner: string; element: Element; within?: string[] }
  /** Changes the drawing order: puts a top-level element at an index. */
  | { type: "move_element"; owner: string; id: string; index: number; from?: number }
  /** Replaces every element of the owner (grouping, ungrouping and other rewrites). */
  | { type: "set_elements"; owner: string; elements: Element[] }
  | { type: "insert_master"; master: Master; index?: number }
  | { type: "remove_master"; id: string; from?: number }
  | { type: "patch_master"; id: string; patch: MasterPatch }
  | { type: "insert_layout"; master: string; layout: Layout; index?: number }
  | { type: "remove_layout"; id: string; master?: string; from?: number }
  /** Moves a layout to an index among the layouts of its master. */
  | { type: "move_layout"; id: string; index: number; master?: string; from?: number }
  | { type: "patch_layout"; id: string; patch: LayoutPatch }
  /** Sets the text style for text outside placeholders; `null` removes it. */
  | { type: "set_default_text"; style: Record<number, LevelStyle> | null }
  /**
   * Sets one value deep inside an element, master or layout, leaving the rest alone: `value` absent removes it. Changes to
   * different values of one element (its position and its fill) are different operations, so they merge.
   */
  | { type: "set_path"; target: PathTarget; path: PathStep[]; value?: unknown }
  /**
   * Changes the text of a shape or, with `cell`, of a table cell (`[row, column]`), as a character-level edit (a
   * `Delta`): two people typing in one text box both keep their words.
   */
  | { type: "edit_text"; owner: string; id: string; within?: string[]; cell?: [number, number]; delta: Delta }
  /** The same for a slide's speaker notes. */
  | { type: "edit_notes"; slide: string; delta: Delta }
  /** A change to the comments saved in the deck (`Deck.comments`). Safe to apply twice. */
  | { type: "comment"; change: CommentChange<DeckAnchor> }
  /** Writes a whole comment thread (`null` removes it). */
  | { type: "set_thread"; id: string; thread: Thread<DeckAnchor> | null };

function bad(message: string): never {
  throw new PliError("invalid_operation", message);
}

function indexOfId<T extends { id: string }>(list: readonly T[], id: string, what: string): number {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw new PliError("not_found", `No ${what} with id "${id}"`);
  return i;
}

function insertAt<T>(list: readonly T[], item: T, index: number | undefined): T[] {
  const at = index === undefined ? list.length : index;
  if (!Number.isInteger(at) || at < 0 || at > list.length) throw new PliError("out_of_range", `Index ${index} is outside 0 to ${list.length}`);
  return [...list.slice(0, at), item, ...list.slice(at)];
}

/** Applies a patch (`null` removes a field) and returns the patch that undoes it. */
function patched<T extends object, P extends object>(target: T, patch: P): [T, Partial<Record<keyof P, unknown>>] {
  const next: Record<string, unknown> = { ...(target as object) };
  const inverse: Record<string, unknown> = {};
  const from = target as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    inverse[key] = key in from && from[key] !== undefined ? from[key] : null;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return [next as T, inverse as Partial<Record<keyof P, unknown>>];
}

export function findLayout(deck: Deck, id: string): { master: Master; layout: Layout } | undefined {
  for (const master of deck.masters) {
    const layout = master.layouts.find((l) => l.id === id);
    if (layout) return { master, layout };
  }
  return undefined;
}

export function layoutOf(deck: Deck, slide: Slide): { master: Master; layout: Layout } | undefined {
  return findLayout(deck, slide.layout);
}

type Owner =
  | { kind: "slide"; slide: Slide; elements: Element[] }
  | { kind: "layout"; master: Master; layout: Layout; elements: Element[] }
  | { kind: "master"; master: Master; elements: Element[] };

function ownerOf(deck: Deck, id: string): Owner {
  const slide = deck.slides.find((s) => s.id === id);
  if (slide) return { kind: "slide", slide, elements: slide.elements };
  const found = findLayout(deck, id);
  if (found) return { kind: "layout", ...found, elements: found.layout.elements };
  const master = deck.masters.find((m) => m.id === id);
  if (master) return { kind: "master", master, elements: master.elements };
  throw new PliError("not_found", `No slide, layout or master with id "${id}"`);
}

/** The top-level elements of a slide, layout or master, or undefined if there is none with this id. */
export function elementsOfOwner(deck: Deck, id: string): Element[] | undefined {
  try {
    return ownerOf(deck, id).elements;
  } catch {
    return undefined;
  }
}

function withElements(deck: Deck, owner: Owner, elements: Element[]): Deck {
  if (owner.kind === "slide") return { ...deck, slides: deck.slides.map((s) => (s === owner.slide ? { ...s, elements } : s)) };
  if (owner.kind === "layout")
    return { ...deck, masters: deck.masters.map((m) => (m === owner.master ? { ...m, layouts: m.layouts.map((l) => (l === owner.layout ? { ...l, elements } : l)) } : m)) };
  return { ...deck, masters: deck.masters.map((m) => (m === owner.master ? { ...m, elements } : m)) };
}

/** Replaces the element with this id, searching inside groups. Returns the list and the element it replaced. */
function replaceDeep(list: readonly Element[], element: Element): { list: Element[]; old: Element } | null {
  for (let i = 0; i < list.length; i++) {
    const item = list[i]!;
    if (item.id === element.id) return { list: [...list.slice(0, i), element, ...list.slice(i + 1)], old: item };
    if (item.type === "group") {
      const inner = replaceDeep(item.children, element);
      if (inner) return { list: [...list.slice(0, i), { ...item, children: inner.list }, ...list.slice(i + 1)], old: inner.old };
    }
  }
  return null;
}

/** All ids in a list of elements, including inside groups. */
export function elementIds(list: readonly Element[]): string[] {
  return list.flatMap((e) => (e.type === "group" ? [e.id, ...elementIds(e.children)] : [e.id]));
}

function checkUniqueIds(list: readonly Element[], what: string): void {
  const ids = elementIds(list);
  if (new Set(ids).size !== ids.length) bad(`${what} has two elements with the same id`);
}

function layoutIdsOf(deck: Deck): Set<string> {
  return new Set(deck.masters.flatMap((m) => m.layouts.map((l) => l.id)));
}

function checkSize(size: SlideSize): void {
  if (!(size.width >= 72 && size.width <= 5760 && size.height >= 72 && size.height <= 5760)) bad("A slide is 1 to 80 inches on each side");
}


// ---- Fine-grained changes ---------------------------------------------------------------------------------------

function notFound(what: string): never {
  throw new PliError("not_found", what);
}

/** The element with this id, wherever it is (inside groups too). */
export function findElementDeep(list: readonly Element[], id: string): Element | undefined {
  for (const e of list) {
    if (e.id === id) return e;
    if (e.type === "group") {
      const inner = findElementDeep(e.children, id);
      if (inner) return inner;
    }
  }
  return undefined;
}

/** Replaces an element found by id with what `fn` makes of it. Returns the new list and the old element. */
function updateDeep(list: readonly Element[], id: string, fn: (el: Element) => Element): { list: Element[]; old: Element } | null {
  for (let i = 0; i < list.length; i++) {
    const item = list[i]!;
    if (item.id === id) return { list: [...list.slice(0, i), fn(item), ...list.slice(i + 1)], old: item };
    if (item.type === "group") {
      const inner = updateDeep(item.children, id, fn);
      if (inner) return { list: [...list.slice(0, i), { ...item, children: inner.list }, ...list.slice(i + 1)], old: inner.old };
    }
  }
  return null;
}

const isContainer = (v: unknown): v is Record<string, unknown> | unknown[] => typeof v === "object" && v !== null;

/** Sets (or, with `remove`, removes) the value at `path` inside `root`, copying what is on the way. */
function setIn(root: unknown, path: readonly PathStep[], value: unknown, remove: boolean): { next: unknown; existed: boolean; old: unknown } {
  if (!isContainer(root)) return notFound(`There is nothing at ${JSON.stringify(path)}`);
  const key = path[0]!;
  if (Array.isArray(root)) {
    const i = typeof key === "number" ? key : Number(key);
    if (!Number.isInteger(i) || i < 0 || i > root.length) return notFound(`There is no item ${String(key)}`);
    if (path.length > 1) {
      const inner = setIn(root[i], path.slice(1), value, remove);
      return { next: root.map((x, k) => (k === i ? inner.next : x)), existed: inner.existed, old: inner.old };
    }
    const existed = i < root.length;
    if (remove) {
      if (!existed) return notFound(`There is no item ${i}`);
      return { next: root.filter((_, k) => k !== i), existed, old: root[i] };
    }
    const next = [...root];
    next[i] = value;
    return { next, existed, old: root[i] };
  }
  const obj = root as Record<string, unknown>;
  const name = String(key);
  if (path.length > 1) {
    if (obj[name] === undefined) return notFound(`There is no "${name}"`);
    const inner = setIn(obj[name], path.slice(1), value, remove);
    return { next: { ...obj, [name]: inner.next }, existed: inner.existed, old: inner.old };
  }
  const existed = obj[name] !== undefined;
  const next: Record<string, unknown> = { ...obj };
  if (remove) delete next[name];
  else next[name] = value;
  return { next, existed, old: obj[name] };
}

/** Where the paragraphs of an edit are, and how to put new ones back. */
function textHolder(el: Element, cell: readonly [number, number] | undefined): { paragraphs: Paragraph[]; write(paragraphs: Paragraph[]): Element } {
  if (cell) {
    if (el.type !== "table") return notFound("Not a table");
    const c = el.rows[cell[0]]?.cells[cell[1]];
    if (!c) return notFound(`No cell ${cell[0]},${cell[1]}`);
    return { paragraphs: c.paragraphs, write: (paragraphs) => ({ ...el, rows: el.rows.map((r, ri) => (ri === cell[0] ? { ...r, cells: r.cells.map((x, ci) => (ci === cell[1] ? { ...x, paragraphs } : x)) } : r)) }) };
  }
  if (el.type !== "shape") return notFound("Only shapes hold text");
  return { paragraphs: el.text?.paragraphs ?? [], write: (paragraphs) => ({ ...el, text: { ...(el.text ?? {}), paragraphs } }) };
}

const sortComments = <A>(thread: Thread<A>): Thread<A> => ({ ...thread, comments: [...thread.comments].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) });

function withComments(deck: Deck, threads: Thread<DeckAnchor>[]): Deck {
  const { comments: _old, ...rest } = deck;
  return threads.length > 0 ? { ...rest, comments: Object.fromEntries(threads.map((t) => [t.id, t])) } : rest;
}

function threadIdOf(change: CommentChange<DeckAnchor>): string {
  return change.type === "thread.create" ? change.thread.id : change.threadId;
}

export const deckReducer: Reducer<Deck, DeckOp> = {
  apply(deck, op) {
    switch (op.type) {
      case "set_deck": {
        if (op.patch.size) checkSize(op.patch.size);
        const [next, inverse] = patched(deck, op.patch);
        return { state: next, inverse: { type: "set_deck", patch: inverse as { title?: string; size?: SlideSize } } };
      }
      case "insert_slide": {
        if (deck.slides.some((s) => s.id === op.slide.id)) bad(`There is already a slide "${op.slide.id}"`);
        if (!layoutIdsOf(deck).has(op.slide.layout)) throw new PliError("not_found", `No layout "${op.slide.layout}"`);
        checkUniqueIds(op.slide.elements, "A slide");
        return { state: { ...deck, slides: insertAt(deck.slides, op.slide, op.index) }, inverse: { type: "remove_slide", id: op.slide.id, from: Math.min(op.index, deck.slides.length) } };
      }
      case "remove_slide": {
        const i = indexOfId(deck.slides, op.id, "slide");
        return { state: { ...deck, slides: deck.slides.filter((_, k) => k !== i) }, inverse: { type: "insert_slide", slide: deck.slides[i]!, index: i } };
      }
      case "move_slide": {
        const i = indexOfId(deck.slides, op.id, "slide");
        if (!Number.isInteger(op.index) || op.index < 0 || op.index >= deck.slides.length) throw new PliError("out_of_range", "Slide index is out of range");
        const rest = deck.slides.filter((_, k) => k !== i);
        return { state: { ...deck, slides: [...rest.slice(0, op.index), deck.slides[i]!, ...rest.slice(op.index)] }, inverse: { type: "move_slide", id: op.id, index: i, from: op.index } };
      }
      case "patch_slide": {
        const i = indexOfId(deck.slides, op.id, "slide");
        if (op.patch.layout !== undefined && !layoutIdsOf(deck).has(op.patch.layout)) throw new PliError("not_found", `No layout "${op.patch.layout}"`);
        if (op.patch.layout === null as never) bad("A slide needs a layout");
        const [slide, inverse] = patched(deck.slides[i]!, op.patch);
        return { state: { ...deck, slides: deck.slides.map((s, k) => (k === i ? slide : s)) }, inverse: { type: "patch_slide", id: op.id, patch: inverse as SlidePatch } };
      }
      case "insert_element": {
        const owner = ownerOf(deck, op.owner);
        const taken = new Set(elementIds(owner.elements));
        for (const id of elementIds([op.element])) if (taken.has(id)) bad(`There is already an element "${id}"`);
        return { state: withElements(deck, owner, insertAt(owner.elements, op.element, op.index)), inverse: { type: "remove_element", owner: op.owner, id: op.element.id, from: op.index === undefined ? owner.elements.length : op.index } };
      }
      case "remove_element": {
        const owner = ownerOf(deck, op.owner);
        const i = indexOfId(owner.elements, op.id, "element");
        return { state: withElements(deck, owner, owner.elements.filter((_, k) => k !== i)), inverse: { type: "insert_element", owner: op.owner, element: owner.elements[i]!, index: i } };
      }
      case "replace_element": {
        const owner = ownerOf(deck, op.owner);
        const done = replaceDeep(owner.elements, op.element);
        if (!done) throw new PliError("not_found", `No element with id "${op.element.id}"`);
        checkUniqueIds(done.list, "The slide");
        return { state: withElements(deck, owner, done.list), inverse: { type: "replace_element", owner: op.owner, element: done.old, ...(op.within ? { within: op.within } : {}) } };
      }
      case "move_element": {
        const owner = ownerOf(deck, op.owner);
        const i = indexOfId(owner.elements, op.id, "element");
        if (!Number.isInteger(op.index) || op.index < 0 || op.index >= owner.elements.length) throw new PliError("out_of_range", "Element index is out of range");
        const rest = owner.elements.filter((_, k) => k !== i);
        return { state: withElements(deck, owner, [...rest.slice(0, op.index), owner.elements[i]!, ...rest.slice(op.index)]), inverse: { type: "move_element", owner: op.owner, id: op.id, index: i, from: op.index } };
      }
      case "set_elements": {
        const owner = ownerOf(deck, op.owner);
        checkUniqueIds(op.elements, "The new list");
        return { state: withElements(deck, owner, op.elements), inverse: { type: "set_elements", owner: op.owner, elements: owner.elements } };
      }
      case "insert_master": {
        if (deck.masters.some((m) => m.id === op.master.id)) bad(`There is already a master "${op.master.id}"`);
        if (op.master.layouts.length === 0) bad("A master needs at least one layout");
        const taken = layoutIdsOf(deck);
        for (const l of op.master.layouts) if (taken.has(l.id)) bad(`There is already a layout "${l.id}"`);
        return { state: { ...deck, masters: insertAt(deck.masters, op.master, op.index) }, inverse: { type: "remove_master", id: op.master.id, from: op.index === undefined ? deck.masters.length : op.index } };
      }
      case "remove_master": {
        const i = indexOfId(deck.masters, op.id, "master");
        if (deck.masters.length === 1) bad("A deck needs at least one master");
        const master = deck.masters[i]!;
        const used = new Set(master.layouts.map((l) => l.id));
        if (deck.slides.some((s) => used.has(s.layout))) bad("Slides still use this master's layouts");
        return { state: { ...deck, masters: deck.masters.filter((_, k) => k !== i) }, inverse: { type: "insert_master", master, index: i } };
      }
      case "patch_master": {
        const i = indexOfId(deck.masters, op.id, "master");
        const [master, inverse] = patched(deck.masters[i]!, op.patch);
        return { state: { ...deck, masters: deck.masters.map((m, k) => (k === i ? master : m)) }, inverse: { type: "patch_master", id: op.id, patch: inverse as MasterPatch } };
      }
      case "insert_layout": {
        const i = indexOfId(deck.masters, op.master, "master");
        if (layoutIdsOf(deck).has(op.layout.id)) bad(`There is already a layout "${op.layout.id}"`);
        const m = deck.masters[i]!;
        return { state: { ...deck, masters: deck.masters.map((x, k) => (k === i ? { ...m, layouts: insertAt(m.layouts, op.layout, op.index) } : x)) }, inverse: { type: "remove_layout", id: op.layout.id, master: op.master, from: op.index === undefined ? m.layouts.length : op.index } };
      }
      case "remove_layout": {
        const found = findLayout(deck, op.id);
        if (!found) throw new PliError("not_found", `No layout "${op.id}"`);
        if (found.master.layouts.length === 1) bad("A master needs at least one layout");
        if (deck.slides.some((s) => s.layout === op.id)) bad("Slides still use this layout");
        const index = found.master.layouts.indexOf(found.layout);
        return {
          state: { ...deck, masters: deck.masters.map((m) => (m === found.master ? { ...m, layouts: m.layouts.filter((l) => l !== found.layout) } : m)) },
          inverse: { type: "insert_layout", master: found.master.id, layout: found.layout, index },
        };
      }
      case "move_layout": {
        const found = findLayout(deck, op.id);
        if (!found) throw new PliError("not_found", `No layout "${op.id}"`);
        const list = found.master.layouts;
        if (!Number.isInteger(op.index) || op.index < 0 || op.index >= list.length) throw new PliError("out_of_range", "Layout index is out of range");
        const from = list.indexOf(found.layout);
        const rest = list.filter((l) => l !== found.layout);
        return {
          state: { ...deck, masters: deck.masters.map((m) => (m === found.master ? { ...m, layouts: [...rest.slice(0, op.index), found.layout, ...rest.slice(op.index)] } : m)) },
          inverse: { type: "move_layout", id: op.id, index: from, master: found.master.id, from: op.index },
        };
      }
      case "patch_layout": {
        const found = findLayout(deck, op.id);
        if (!found) throw new PliError("not_found", `No layout "${op.id}"`);
        const [layout, inverse] = patched(found.layout, op.patch);
        return {
          state: { ...deck, masters: deck.masters.map((m) => (m === found.master ? { ...m, layouts: m.layouts.map((l) => (l === found.layout ? layout : l)) } : m)) },
          inverse: { type: "patch_layout", id: op.id, patch: inverse as LayoutPatch },
        };
      }
      case "set_default_text": {
        const next = { ...deck };
        if (op.style === null) delete next.defaultTextStyle;
        else next.defaultTextStyle = op.style;
        return { state: next, inverse: { type: "set_default_text", style: deck.defaultTextStyle ?? null } };
      }
      case "set_path": {
        const t = op.target;
        if (op.path.length === 0) bad("A path names a value");
        if (op.path[0] === "id") bad("An id can't be changed");
        const remove = !("value" in op);
        const wrap = <T,>(subject: T): { next: T; inverse: DeckOp } => {
          const r = setIn(subject, op.path, op.value, remove);
          return { next: r.next as T, inverse: r.existed ? { type: "set_path", target: t, path: op.path, value: r.old } : { type: "set_path", target: t, path: op.path } };
        };
        if ("owner" in t) {
          const owner = ownerOf(deck, t.owner);
          let inverse: DeckOp | undefined;
          const done = updateDeep(owner.elements, t.id, (el) => {
            const w = wrap(el);
            inverse = w.inverse;
            return w.next;
          });
          if (!done) return notFound(`No element "${t.id}"`);
          return { state: withElements(deck, owner, done.list), inverse: inverse! };
        }
        if ("master" in t) {
          const i = indexOfId(deck.masters, t.master, "master");
          const w = wrap(deck.masters[i]!);
          return { state: { ...deck, masters: deck.masters.map((m, k) => (k === i ? w.next : m)) }, inverse: w.inverse };
        }
        const found = findLayout(deck, t.layout);
        if (!found) return notFound(`No layout "${t.layout}"`);
        const w = wrap(found.layout);
        return { state: { ...deck, masters: deck.masters.map((m) => (m === found.master ? { ...m, layouts: m.layouts.map((l) => (l === found.layout ? w.next : l)) } : m)) }, inverse: w.inverse };
      }
      case "edit_text": {
        const owner = ownerOf(deck, op.owner);
        const el = findElementDeep(owner.elements, op.id);
        if (!el) return notFound(`No element "${op.id}"`);
        const held = textHolder(el, op.cell);
        const doc = paragraphsToDoc(held.paragraphs);
        const next = held.write(docToParagraphs(applyDelta(doc, op.delta)));
        const done = updateDeep(owner.elements, op.id, () => next)!;
        return { state: withElements(deck, owner, done.list), inverse: { ...op, delta: invertDelta(op.delta, doc) } };
      }
      case "edit_notes": {
        const i = indexOfId(deck.slides, op.slide, "slide");
        const doc = stringToDoc(deck.slides[i]!.notes);
        const notes = docToString(applyDelta(doc, op.delta));
        return { state: { ...deck, slides: deck.slides.map((s, k) => (k === i ? { ...s, notes } : s)) }, inverse: { ...op, delta: invertDelta(op.delta, doc) } };
      }
      case "comment": {
        const id = threadIdOf(op.change);
        const before = deck.comments?.[id];
        const all = Object.values(deck.comments ?? {});
        const next = applyCommentChange(all, op.change).map((t) => (t.id === id ? sortComments(t) : t));
        return { state: withComments(deck, next), inverse: { type: "set_thread", id, thread: before ?? null } };
      }
      case "set_thread": {
        const before = deck.comments?.[op.id];
        const rest = Object.values(deck.comments ?? {}).filter((t) => t.id !== op.id);
        return { state: withComments(deck, op.thread ? [...rest, op.thread] : rest), inverse: { type: "set_thread", id: op.id, thread: before ?? null } };
      }
      default:
        return bad(`Unknown operation "${(op as { type: string }).type}"`);
    }
  },
};
