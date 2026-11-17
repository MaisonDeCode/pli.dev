/**
 * Turns the operations the editing commands write into the finer ones that can be merged with other people's.
 *
 * The commands change an element by writing the whole new element (`replace_element`): handy to write, but two
 * people moving and recolouring one shape would each overwrite the other. Here each such operation is compared with the
 * element as it is and replaced by the changes it really makes: one `set_path` for each value that differs, and an
 * `edit_text` for text, so only what a person touched is theirs. Operations that put things in a list also
 * say where they were (`from`), which is what merging list changes needs. The result is checked: if the finer operations don't
 * give exactly the element asked for, the whole-element operation is kept.
 */
import { PliError } from "@pli.dev/core";
import { canonicalJson, diffDocs, docToParagraphs, isNoop, paragraphsToDoc, sameValue, stringToDoc } from "./delta";
import type { Deck, Element, Paragraph } from "./model";
import { deckReducer, elementsOfOwner, findElementDeep, findLayout, type DeckOp, type PathStep, type PathTarget } from "./ops";

/** The most `set_path` operations one replaced element is split into; a bigger change is kept whole. */
const MAX_PARTS = 400;

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An element as JSON with its text normalised the way the editing operations leave it, so two equal elements are equal text. */
function canonicalElement(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (isPlain(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = k === "paragraphs" && Array.isArray(x) ? docToParagraphs(paragraphsToDoc(x as Paragraph[])).map(norm) : norm(x);
      return out;
    }
    return v;
  };
  return canonicalJson(norm(value));
}

/** The groups an element is inside, outermost first, or undefined if it isn't in the list. */
export function withinOf(list: readonly Element[], id: string, path: string[] = []): string[] | undefined {
  for (const e of list) {
    if (e.id === id) return path;
    if (e.type === "group") {
      const inner = withinOf(e.children, id, [...path, e.id]);
      if (inner) return inner;
    }
  }
  return undefined;
}

class TooBig extends Error {}

/** The finer operations that turn `a` into `b` (same id and type), for the element named by `target`. */
function diffElement(target: Extract<PathTarget, { owner: string }>, a: Element, b: Element, out: DeckOp[]): boolean {
  if (a.id !== b.id || a.type !== b.type) return false;
  const emit = (op: DeckOp) => {
    out.push(op);
    if (out.length > MAX_PARTS) throw new TooBig();
  };
  const set = (path: PathStep[], value: unknown) => emit({ type: "set_path", target, path, value });
  const unset = (path: PathStep[]) => emit({ type: "set_path", target, path });
  const text = (cell: [number, number] | undefined, x: Paragraph[], y: Paragraph[]) => {
    const delta = diffDocs(paragraphsToDoc(x), paragraphsToDoc(y));
    if (!isNoop(delta)) emit({ type: "edit_text", owner: target.owner, id: target.id, ...(target.within ? { within: target.within } : {}), ...(cell ? { cell } : {}), delta });
  };
  const key = (path: PathStep[], k: string, x: Record<string, unknown>, y: Record<string, unknown>) => {
    const xv = x[k];
    const yv = y[k];
    if (yv === undefined) {
      if (xv !== undefined) unset([...path, k]);
    } else if (xv === undefined) set([...path, k], yv);
    else walk([...path, k], xv, yv);
  };
  const walk = (path: PathStep[], x: unknown, y: unknown): void => {
    if (sameValue(x, y)) return;
    if (isPlain(x) && isPlain(y)) {
      const shapeText = a.type === "shape" && path.length === 1 && path[0] === "text";
      const cell = a.type === "table" && path.length === 4 && path[0] === "rows" && path[2] === "cells";
      if (shapeText || cell) {
        if (Array.isArray(x.paragraphs) && Array.isArray(y.paragraphs)) text(cell ? [path[1] as number, path[3] as number] : undefined, x.paragraphs as Paragraph[], y.paragraphs as Paragraph[]);
        else key(path, "paragraphs", x, y);
        for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (k !== "paragraphs") key(path, k, x, y);
        return;
      }
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (path.length === 0 && (k === "id" || k === "type")) continue;
        if (path.length === 0 && k === "children" && a.type === "group") continue;
        key(path, k, x, y);
      }
      return;
    }
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) {
      for (let i = 0; i < x.length; i++) walk([...path, i], x[i], y[i]);
      return;
    }
    set(path, y);
  };
  walk([], a, b);
  if (a.type === "group" && b.type === "group" && !sameValue(a.children, b.children)) {
    const same = a.children.length === b.children.length && a.children.every((c, i) => c.id === b.children[i]!.id && c.type === b.children[i]!.type);
    const nested: DeckOp[] = [];
    const within = [...(target.within ?? []), a.id];
    if (same && a.children.every((c, i) => diffElement({ owner: target.owner, id: c.id, within }, c, b.children[i]!, nested))) for (const op of nested) emit(op);
    else set(["children"], b.children);
  }
  return true;
}

/** The operations that do what `op` does, in the finer form, for the deck `state` it is applied to. */
function fine(state: Deck, op: DeckOp): DeckOp[] {
  switch (op.type) {
    case "remove_slide": {
      const from = state.slides.findIndex((s) => s.id === op.id);
      return [from < 0 ? op : { ...op, from }];
    }
    case "move_slide": {
      const from = state.slides.findIndex((s) => s.id === op.id);
      return [from < 0 ? op : { ...op, from }];
    }
    case "insert_element": {
      const list = elementsOfOwner(state, op.owner);
      return [list && op.index === undefined ? { ...op, index: list.length } : op];
    }
    case "remove_element":
    case "move_element": {
      const from = elementsOfOwner(state, op.owner)?.findIndex((e) => e.id === op.id) ?? -1;
      return [from < 0 ? op : { ...op, from }];
    }
    case "insert_master":
      return [op.index === undefined ? { ...op, index: state.masters.length } : op];
    case "remove_master": {
      const from = state.masters.findIndex((m) => m.id === op.id);
      return [from < 0 ? op : { ...op, from }];
    }
    case "insert_layout": {
      const m = state.masters.find((x) => x.id === op.master);
      return [m && op.index === undefined ? { ...op, index: m.layouts.length } : op];
    }
    case "remove_layout":
    case "move_layout": {
      const found = findLayout(state, op.id);
      return [found ? { ...op, master: found.master.id, from: found.master.layouts.indexOf(found.layout) } : op];
    }
    case "replace_element": {
      const list = elementsOfOwner(state, op.owner);
      const within = list ? withinOf(list, op.element.id) : undefined;
      const old = list ? findElementDeep(list, op.element.id) : undefined;
      if (!list || !within || !old) return [op];
      const out: DeckOp[] = [];
      try {
        const target: Extract<PathTarget, { owner: string }> = { owner: op.owner, id: op.element.id, ...(within.length ? { within } : {}) };
        if (!diffElement(target, old, op.element, out)) return [{ ...op, ...(within.length ? { within } : {}) }];
        // The finer operations must make the element asked for.
        let next = state;
        for (const o of out) next = deckReducer.apply(next, o).state;
        const got = findElementDeep(elementsOfOwner(next, op.owner) ?? [], op.element.id);
        if (!got || canonicalElement(got) !== canonicalElement(op.element)) return [{ ...op, ...(within.length ? { within } : {}) }];
        return out;
      } catch (error) {
        if (error instanceof TooBig || error instanceof PliError) return [{ ...op, ...(within.length ? { within } : {}) }];
        throw error;
      }
    }
    case "patch_slide": {
      const slide = state.slides.find((s) => s.id === op.id);
      if (!slide || typeof op.patch.notes !== "string") return [op];
      const { notes, ...rest } = op.patch;
      const delta = diffDocs(stringToDoc(slide.notes), stringToDoc(notes));
      const out: DeckOp[] = [];
      if (Object.keys(rest).length > 0) out.push({ ...op, patch: rest });
      if (!isNoop(delta)) out.push({ type: "edit_notes", slide: op.id, delta });
      return out;
    }
    case "patch_master": {
      const master = state.masters.find((m) => m.id === op.id);
      if (!master) return [op];
      const rest: Record<string, unknown> = {};
      const out: DeckOp[] = [];
      const target: PathTarget = { master: op.id };
      for (const [k, v] of Object.entries(op.patch)) {
        if ((k === "theme" || k === "textStyles") && v !== undefined && v !== null) {
          const walk = (path: PathStep[], x: unknown, y: unknown): void => {
            if (sameValue(x, y)) return;
            if (isPlain(x) && isPlain(y)) {
              for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
                if (y[key] === undefined) out.push({ type: "set_path", target, path: [...path, key] });
                else if (x[key] === undefined) out.push({ type: "set_path", target, path: [...path, key], value: y[key] });
                else walk([...path, key], x[key], y[key]);
              }
            } else out.push({ type: "set_path", target, path, value: y });
          };
          walk([k], (master as unknown as Record<string, unknown>)[k], v);
        } else rest[k] = v;
      }
      if (out.length > MAX_PARTS) return [op];
      return Object.keys(rest).length > 0 ? [{ ...op, patch: rest }, ...out] : out;
    }
    default:
      return [op];
  }
}

/**
 * The finer, mergeable form of `ops` applied one after the other to `deck`. If an operation can't be applied the
 * operations are returned as they are, so the caller's own error comes from applying them.
 */
export function normalizeOps(deck: Deck, ops: readonly DeckOp[]): DeckOp[] {
  const out: DeckOp[] = [];
  let state = deck;
  try {
    for (const op of ops) {
      for (const f of fine(state, op)) {
        state = deckReducer.apply(state, f).state;
        out.push(f);
      }
    }
  } catch {
    return [...ops];
  }
  return out;
}

