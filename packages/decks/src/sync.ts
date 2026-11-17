/**
 * Live editing of a deck: how two people's changes are merged.
 *
 *     const sync = new SyncClient({ session: deck.core, room, model: deckSyncModel });
 *     const authority = createAuthority({ store, model: deckSyncModel });
 *
 * What merges and how:
 *
 * - **Values**: each value of an element, master or layout is its own thing (`set_path`): two people moving, resizing and
 *   colouring one shape all keep their changes; the same value changed twice goes to the later change; a change to a
 *   value and a change that replaces what it is inside (a whole fill, a whole table) goes to the one that replaces.
 * - **Text** in shapes and table cells, and speaker notes: merged character by character, with formatting (`edit_text`).
 * - **Lists** (slides of the deck, elements of a slide, layouts of a master): inserts, deletes and moves all keep
 *   their places however they cross; two things inserted at one place go in the order they were accepted; moving one
 *   thing twice goes to the later move.
 * - **Deleting**: a change to something that was deleted (an element, a slide, a layout) is dropped.
 * - **Comments**: replies, edits and resolving merge by thread and comment.
 * - A change that rewrites everything on a slide at once (grouping, ungrouping, rescaling) beats other changes to that slide's elements.
 *
 * Two changes made from different states can't both be right when a layout or master is deleted while someone chooses it;
 * the sequencer then leaves the second out and that person's editor reloads. The client's fingerprint check
 * (`hash`) puts right anything else that does not merge cleanly.
 */
import type { CommentChange, SyncModel } from "@pli.dev/core";
import { canonicalJson, mapIndex, transformDelta, type Delta } from "./delta";
import { type ListOp, transformListOp } from "./listot";
import type { Deck, DeckAnchor } from "./model";
import { deckReducer, type DeckOp, type PathStep } from "./ops";
import type { DeckSelection } from "./session";

/** A short fingerprint of a deck (FNV-1a over its canonical JSON, with its length). Equal decks have equal fingerprints. */
export function hashDeck(deck: Deck): string {
  const text = canonicalJson(deck);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(36)}.${text.length.toString(36)}`;
}

// ---- What an operation touches -----------------------------------------------------------------------------------

/** One value an operation writes. */
interface Part {
  /** Names the thing that holds the value: `deck`, `slide:ID`, `master:ID`, `layout:ID`, `el:ID`. */
  ent: string;
  path: PathStep[];
  /** `set`: one value; `text`: an edit of text, merged character by character; `whole`: replaces an element and everything in it; `elements`: replaces all elements of `owner`. */
  kind: "set" | "text" | "whole" | "elements";
  /** For elements: the groups it is inside and its own id, outermost first. */
  chain?: string[];
  owner?: string;
  /** For a bag of values (`patch_slide`): which key this is. */
  key?: string;
}

interface Info {
  /** Things that must exist for the operation to apply. */
  needs: string[];
  /** Things the operation removes. */
  kills: string[];
  list?: { key: string; op: ListOp };
  parts: Part[];
  thread?: string;
}

const infos = new WeakMap<object, Info>();

function bagParts(ent: string, patch: object): Part[] {
  const values = patch as Record<string, unknown>;
  return Object.keys(values)
    .filter((k) => values[k] !== undefined)
    .map((key) => ({ ent, path: [key], kind: "set" as const, key }));
}

function elementPart(owner: string, id: string, within: string[] | undefined, kind: Part["kind"], path: PathStep[]): Part {
  return { ent: `el:${id}`, path, kind, chain: [...(within ?? []), id], owner };
}

function threadOf(change: CommentChange<DeckAnchor>): string {
  return change.type === "thread.create" ? change.thread.id : change.threadId;
}

function infoOf(op: DeckOp): Info {
  const known = infos.get(op);
  if (known) return known;
  const info = computeInfo(op);
  infos.set(op, info);
  return info;
}

function computeInfo(op: DeckOp): Info {
  const none: Info = { needs: [], kills: [], parts: [] };
  switch (op.type) {
    case "set_deck":
      return { ...none, parts: bagParts("deck", op.patch) };
    case "set_default_text":
      return { ...none, parts: [{ ent: "deck", path: ["defaultTextStyle"], kind: "set", key: "defaultTextStyle" }] };
    case "insert_slide":
      return { ...none, list: { key: "slides", op: { k: "ins", i: op.index, x: op.slide.id } } };
    case "remove_slide":
      return { needs: [op.id], kills: [op.id], parts: [], ...(op.from === undefined ? {} : { list: { key: "slides", op: { k: "del" as const, i: op.from, x: op.id } } }) };
    case "move_slide":
      return { needs: [op.id], kills: [], parts: [], ...(op.from === undefined ? {} : { list: { key: "slides", op: { k: "mov" as const, i: op.from, j: op.index, x: op.id } } }) };
    case "patch_slide":
      return { needs: [op.id], kills: [], parts: bagParts(`slide:${op.id}`, op.patch) };
    case "edit_notes":
      return { needs: [op.slide], kills: [], parts: [{ ent: `slide:${op.slide}`, path: ["notes"], kind: "text" }] };
    case "insert_element":
      return { needs: [op.owner], kills: [], parts: [], ...(op.index === undefined ? {} : { list: { key: `el:${op.owner}`, op: { k: "ins" as const, i: op.index, x: op.element.id } } }) };
    case "remove_element":
      return { needs: [op.owner, op.id], kills: [op.id], parts: [], ...(op.from === undefined ? {} : { list: { key: `el:${op.owner}`, op: { k: "del" as const, i: op.from, x: op.id } } }) };
    case "move_element":
      return { needs: [op.owner, op.id], kills: [], parts: [], ...(op.from === undefined ? {} : { list: { key: `el:${op.owner}`, op: { k: "mov" as const, i: op.from, j: op.index, x: op.id } } }) };
    case "replace_element":
      return { needs: [op.owner, ...(op.within ?? []), op.element.id], kills: [], parts: [elementPart(op.owner, op.element.id, op.within, "whole", [])] };
    case "set_elements":
      return { needs: [op.owner], kills: [], parts: [{ ent: `els:${op.owner}`, path: [], kind: "elements", owner: op.owner }] };
    case "insert_master":
      return { ...none, ...(op.index === undefined ? {} : { list: { key: "masters", op: { k: "ins" as const, i: op.index, x: op.master.id } } }) };
    case "remove_master":
      return { needs: [op.id], kills: [op.id], parts: [], ...(op.from === undefined ? {} : { list: { key: "masters", op: { k: "del" as const, i: op.from, x: op.id } } }) };
    case "patch_master":
      return { needs: [op.id], kills: [], parts: bagParts(`master:${op.id}`, op.patch) };
    case "insert_layout":
      return { needs: [op.master], kills: [], parts: [], ...(op.index === undefined ? {} : { list: { key: `lay:${op.master}`, op: { k: "ins" as const, i: op.index, x: op.layout.id } } }) };
    case "remove_layout":
      return { needs: [op.id], kills: [op.id], parts: [], ...(op.from === undefined || op.master === undefined ? {} : { list: { key: `lay:${op.master}`, op: { k: "del" as const, i: op.from, x: op.id } } }) };
    case "move_layout":
      return { needs: [op.id], kills: [], parts: [], ...(op.from === undefined || op.master === undefined ? {} : { list: { key: `lay:${op.master}`, op: { k: "mov" as const, i: op.from, j: op.index, x: op.id } } }) };
    case "patch_layout":
      return { needs: [op.id], kills: [], parts: bagParts(`layout:${op.id}`, op.patch) };
    case "set_path": {
      const t = op.target;
      if ("owner" in t) return { needs: [t.owner, ...(t.within ?? []), t.id], kills: [], parts: [elementPart(t.owner, t.id, t.within, "set", op.path)] };
      if ("master" in t) return { needs: [t.master], kills: [], parts: [{ ent: `master:${t.master}`, path: op.path, kind: "set" }] };
      return { needs: [t.layout], kills: [], parts: [{ ent: `layout:${t.layout}`, path: op.path, kind: "set" }] };
    }
    case "edit_text":
      return {
        needs: [op.owner, ...(op.within ?? []), op.id],
        kills: [],
        parts: [elementPart(op.owner, op.id, op.within, "text", op.cell ? ["rows", op.cell[0], "cells", op.cell[1], "paragraphs"] : ["text", "paragraphs"])],
      };
    case "comment":
      return { ...none, thread: threadOf(op.change) };
    case "set_thread":
      return { ...none, thread: op.id };
  }
}

// ---- Rewriting operations ---------------------------------------------------------------------------------------

/** The operation with the place in its list changed. */
function withList(op: DeckOp, l: ListOp): DeckOp {
  const i = l.i;
  const j = l.k === "mov" ? l.j : undefined;
  switch (op.type) {
    case "insert_slide":
    case "insert_element":
    case "insert_master":
    case "insert_layout":
      return { ...op, index: i };
    case "remove_slide":
    case "remove_element":
    case "remove_master":
    case "remove_layout":
      return { ...op, from: i };
    case "move_slide":
    case "move_element":
    case "move_layout":
      return { ...op, from: i, index: j! };
    default:
      return op;
  }
}

/** The operation that takes out what the insert operation `ins` put in the list, at the place it put it. */
function removal(ins: DeckOp, at: ListOp): DeckOp {
  switch (ins.type) {
    case "insert_slide":
      return { type: "remove_slide", id: ins.slide.id, from: at.i };
    case "insert_element":
      return { type: "remove_element", owner: ins.owner, id: ins.element.id, from: at.i };
    case "insert_master":
      return { type: "remove_master", id: ins.master.id, from: at.i };
    case "insert_layout":
      return { type: "remove_layout", id: ins.layout.id, master: ins.master, from: at.i };
    default:
      return ins;
  }
}

/** The operation without some of the keys it writes; null when none are left. */
function withoutKeys(op: DeckOp, drop: ReadonlySet<string>): DeckOp | null {
  if (drop.size === 0) return op;
  if (op.type === "patch_slide" || op.type === "patch_master" || op.type === "patch_layout" || op.type === "set_deck") {
    const patch = Object.fromEntries(Object.entries(op.patch).filter(([k]) => !drop.has(k)));
    return Object.keys(patch).length > 0 ? ({ ...op, patch } as DeckOp) : null;
  }
  return null;
}

const isPrefix = (a: readonly PathStep[], b: readonly PathStep[]): boolean => a.length <= b.length && a.every((s, i) => String(s) === String(b[i]));

type Verdict = "none" | "l" | "e" | "text";

/** Which of two writes survives: `l` (the later) or `e` (the earlier) wins, `none` they don't touch, `text` they merge. */
function clash(a: Part, b: Part): Verdict {
  if (a.kind === "elements" || b.kind === "elements") {
    if (a.kind === "elements" && b.kind === "elements") return a.owner === b.owner ? "l" : "none";
    if (a.kind === "elements") return b.owner === a.owner ? "l" : "none";
    return a.owner === b.owner ? "e" : "none";
  }
  if (a.kind === "whole" || b.kind === "whole") {
    const aw = a.kind === "whole" && !!b.chain?.includes(a.chain![a.chain!.length - 1]!);
    const bw = b.kind === "whole" && !!a.chain?.includes(b.chain![b.chain!.length - 1]!);
    if (aw && bw) return "l";
    if (aw) return "l";
    if (bw) return "e";
    return "none";
  }
  if (a.ent !== b.ent) return "none";
  if (a.kind === "text" && b.kind === "text") return sameShape(a.path, b.path) ? "text" : "none";
  const aAbove = isPrefix(a.path, b.path);
  const bAbove = isPrefix(b.path, a.path);
  if (!aAbove && !bAbove) return "none";
  if (aAbove && bAbove) return a.kind === "text" ? "e" : b.kind === "text" ? "l" : "l";
  return aAbove ? "l" : "e";
}

const sameShape = (a: readonly PathStep[], b: readonly PathStep[]): boolean => a.length === b.length && a.every((s, i) => String(s) === String(b[i]));

function deltaOf(op: DeckOp): Delta {
  return (op as { delta: Delta }).delta;
}

function withDelta(op: DeckOp, delta: Delta): DeckOp | null {
  return delta.length === 0 ? null : ({ ...op, delta } as DeckOp);
}

/**
 * Transforms `l` (made later) and `e` (accepted earlier), both made from the same deck, into `l'` and `e'` so that `e`
 * then `l'` and `l` then `e'` give the same deck. An empty list means nothing is left to do.
 */
function pair(l: DeckOp, e: DeckOp): [DeckOp[], DeckOp[]] {
  const il = infoOf(l);
  const ie = infoOf(e);

  // A slide made with a layout that someone else deleted goes too; a layout deleted under a slide someone else made takes the slide with it.
  if (l.type === "insert_slide" && e.type === "remove_layout" && l.slide.layout === e.id) return [[], [{ type: "remove_slide", id: l.slide.id, from: l.index }, e]];
  if (e.type === "insert_slide" && l.type === "remove_layout" && e.slide.layout === l.id) return [[{ type: "remove_slide", id: e.slide.id, from: e.index }, l], []];

  // Lists.
  if (il.list && ie.list && il.list.key === ie.list.key) {
    // The same thing put back by two people (both undid its deletion): the later copy replaces the earlier.
    if (il.list.op.k === "ins" && ie.list.op.k === "ins" && il.list.op.x === ie.list.op.x) return [[removal(e, ie.list.op), l], []];
    const [lo, eo] = transformListOp(il.list.op, ie.list.op);
    return [lo.map((o) => withList(l, o)), eo.map((o) => withList(e, o))];
  }
  // Something that works on a thing the other change removed has nothing left to do.
  const lDead = ie.kills.some((k) => il.needs.includes(k));
  const eDead = il.kills.some((k) => ie.needs.includes(k));
  if (lDead && eDead) return [[], []];
  if (lDead) return [[], [e]];
  if (eDead) return [[l], []];

  // Rewriting all the elements of an owner beats changes to its list.
  if (l.type === "set_elements" && ie.list?.key === `el:${l.owner}`) return [[l], []];
  if (e.type === "set_elements" && il.list?.key === `el:${e.owner}`) return [[], [e]];

  // Comments.
  if (il.thread !== undefined && il.thread === ie.thread) {
    if (l.type === "set_thread") return [[l], []];
    if (e.type === "set_thread") return [[], [e]];
    if (l.type === "comment" && e.type === "comment") {
      const a = l.change;
      const b = e.change;
      const flips = (c: CommentChange<DeckAnchor>) => c.type === "thread.resolve" || c.type === "thread.reopen";
      if ((flips(a) && flips(b)) || (a.type === "thread.create" && b.type === "thread.create") || (a.type === "comment.edit" && b.type === "comment.edit" && a.commentId === b.commentId)) return [[l], []];
    }
    return [[l], [e]];
  }

  // Values.
  if (il.parts.length > 0 && ie.parts.length > 0) {
    const dropL = new Set<string>();
    const dropE = new Set<string>();
    let wholeL = false;
    let wholeE = false;
    let text = false;
    for (const a of il.parts) {
      for (const b of ie.parts) {
        const v = clash(a, b);
        if (v === "l") {
          if (b.key !== undefined) dropE.add(b.key);
          else wholeE = true;
        } else if (v === "e") {
          if (a.key !== undefined) dropL.add(a.key);
          else wholeL = true;
        } else if (v === "text") text = true;
      }
    }
    if (text && !wholeL && !wholeE) {
      const lo = withDelta(l, transformDelta(deltaOf(l), deltaOf(e), { baseFirst: true, selfWins: true }));
      const eo = withDelta(e, transformDelta(deltaOf(e), deltaOf(l), { baseFirst: false, selfWins: false }));
      return [lo ? [lo] : [], eo ? [eo] : []];
    }
    const l2 = wholeL ? null : withoutKeys(l, dropL);
    const e2 = wholeE ? null : withoutKeys(e, dropE);
    const keepL = !wholeL && (dropL.size === 0 || l2 !== null);
    const keepE = !wholeE && (dropE.size === 0 || e2 !== null);
    return [keepL && (l2 ?? l) ? [l2 ?? l] : [], keepE && (e2 ?? e) ? [e2 ?? e] : []];
  }
  return [[l], [e]];
}

/**
 * Transforms two lists of operations made from the same deck. `earlier` was accepted first. Returns `later` as it must be
 * applied after `earlier`, and `earlier` as it must be applied after `later`.
 */
export function transformDeckOps(later: readonly DeckOp[], earlier: readonly DeckOp[]): [DeckOp[], DeckOp[]] {
  return grid(later, earlier);
}

function grid(L: readonly DeckOp[], E: readonly DeckOp[]): [DeckOp[], DeckOp[]] {
  if (L.length === 0 || E.length === 0) return [[...L], [...E]];
  if (L.length === 1 && E.length === 1) return pair(L[0]!, E[0]!);
  if (L.length === 1) {
    const [first, ...rest] = E;
    const [l1, e1] = pair(L[0]!, first!);
    const [l2, er] = grid(l1, rest);
    return [l2, [...e1, ...er]];
  }
  const [first, ...rest] = L;
  const [l1, E1] = grid([first!], E);
  const [lr, E2] = grid(rest, E1);
  return [[...l1, ...lr], E2];
}

// ---- Selections and cursors -------------------------------------------------------------------------------------

/** What other people's changes do to what one person has selected: whatever is gone is no longer selected. */
export function mapDeckSelection(selection: DeckSelection | null, ops: readonly DeckOp[]): DeckSelection | null {
  if (!selection) return selection;
  const gone = new Set<string>();
  const slides = new Set<string>();
  const edited = new Set<string>();
  for (const op of ops) {
    if (op.type === "remove_element") gone.add(op.id);
    else if (op.type === "remove_slide") slides.add(op.id);
    else if (op.type === "edit_text") edited.add(op.id);
    else if (op.type === "replace_element" || op.type === "set_elements") {
      if (op.type === "set_elements") edited.add("*");
      else edited.add(op.element.id);
    }
  }
  if (gone.size === 0 && slides.size === 0 && edited.size === 0) return selection;
  let next = selection;
  if (selection.slide && slides.has(selection.slide)) next = { ...next, slide: null, elements: [], text: undefined };
  if (next.slides?.some((s) => slides.has(s))) next = { ...next, slides: next.slides.filter((s) => !slides.has(s)) };
  if (next.elements.some((e) => gone.has(e))) next = { ...next, elements: next.elements.filter((e) => !gone.has(e)) };
  if (next.text && (gone.has(next.text.element) || edited.has(next.text.element) || edited.has("*"))) next = { ...next, text: undefined };
  return next;
}

/** What you tell other people about yourself (`room.setPresence`), as `DeckPresence`. */
export interface DeckPresence {
  /** The slide shown. */
  slide?: string | null;
  /** The selected elements. */
  selection?: string[];
  /** A text cursor or selection, counting a paragraph break as one character (`cell`: the table cell). */
  caret?: { element: string; cell?: [number, number]; anchor: number; focus: number } | null;
}

/** Moves other people's selections and text cursors through changes to the deck. */
export function mapDeckPresence(state: Record<string, unknown>, ops: readonly DeckOp[]): Record<string, unknown> {
  let next = state;
  const caret = state.caret as DeckPresence["caret"] | undefined;
  const selection = state.selection as string[] | undefined;
  const slide = state.slide as string | null | undefined;
  const removed = new Set<string>();
  const removedSlides = new Set<string>();
  for (const op of ops) {
    if (op.type === "remove_element") removed.add(op.id);
    else if (op.type === "remove_slide") removedSlides.add(op.id);
  }
  if (slide && removedSlides.has(slide)) next = { ...next, slide: null, selection: [], caret: null };
  if (Array.isArray(selection) && selection.some((id) => removed.has(id))) next = { ...next, selection: selection.filter((id) => !removed.has(id)) };
  if (caret) {
    if (removed.has(caret.element)) next = { ...next, caret: null };
    else {
      let anchor = caret.anchor;
      let focus = caret.focus;
      for (const op of ops) {
        if (op.type !== "edit_text" || op.id !== caret.element) continue;
        if (JSON.stringify(op.cell ?? null) !== JSON.stringify(caret.cell ?? null)) continue;
        anchor = mapIndex(anchor, op.delta);
        focus = mapIndex(focus, op.delta);
      }
      if (anchor !== caret.anchor || focus !== caret.focus) next = { ...next, caret: { ...caret, anchor, focus } };
    }
  }
  return next;
}

/**
 * How deck operations combine, for `SyncClient` and `createAuthority`. See the top of this file for the rules.
 */
export const deckSyncModel: SyncModel<Deck, DeckOp> = {
  apply: (deck, op) => deckReducer.apply(deck, op).state,
  transform: transformDeckOps,
  mapMeta: mapDeckSelection as SyncModel<Deck, DeckOp>["mapMeta"],
  mapPresence: mapDeckPresence,
  hash: hashDeck,
};
