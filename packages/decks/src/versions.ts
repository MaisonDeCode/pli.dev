import { VersionHistory, canonicalJson, type AutoSaveOptions, type DiffSummary, type Users, type VersionStorage, type VersionSupport } from "@pli.dev/core";
import type { Deck, Element, Layout, Master, Slide } from "./model";
import { deckReducer, type DeckOp } from "./ops";
import type { DeckSelection, DeckSession } from "./session";
import { hashDeck } from "./sync";

/**
 * Named versions of a presentation. A version is the `Deck` as it was (plain JSON), and restoring one is an ordinary list of
 * deck operations, so it is one undoable step, merges with what other people are doing, and reaches everyone like any other edit.
 *
 * What a restore does not bring back: the deck's `id` (it names the file, not its content), the comment threads (a restore brings
 * back the slides, not the conversation about them), and the order of the masters in the list (layouts and slides come back in the
 * order of the version).
 */

/** Equal as JSON, whatever the order of keys, with `undefined` the same as absent. */
const same = (a: unknown, b: unknown): boolean => a === b || canonicalJson(a) === canonicalJson(b);

const keysOf = (a: object, b: object): string[] => [...new Set([...Object.keys(a), ...Object.keys(b)])];

/** What to patch on `from` to make it `to`: the keys that differ, with `null` for a key that goes. */
function diffPatch(from: object, to: object, skip: readonly string[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of keysOf(from, to)) {
    if (skip.includes(key)) continue;
    const a = (from as Record<string, unknown>)[key];
    const b = (to as Record<string, unknown>)[key];
    if (!same(a, b)) patch[key] = b === undefined ? null : b;
  }
  return patch;
}

/** The ids of a longest increasing run of `order` (each kept item's target position, in the order they are now): these stay where they are, the rest are moved. */
function stayers(ids: readonly string[], order: readonly number[]): Set<string> {
  const tails: number[] = [];
  const back: number[] = new Array(order.length).fill(-1);
  for (let i = 0; i < order.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (order[tails[mid]!]! < order[i]!) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) back[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const keep = new Set<string>();
  for (let i = tails.length > 0 ? tails[tails.length - 1]! : -1; i >= 0; i = back[i]!) keep.add(ids[i]!);
  return keep;
}

interface Listed {
  id: string;
}

/**
 * Puts the things of `current` (all of which `target` also has) in the order of `target`, calling `insert(item, index)` for the
 * ones only `target` has and `move(id, index)` for the fewest of the others. Each index is where the thing goes in the list as it
 * is at that moment (a thing being moved is taken out first), right after the target item that precedes it.
 */
function reorder<T extends Listed>(current: readonly T[], target: readonly T[], ops: { insert(item: T, index: number): void; move(id: string, index: number): void }): void {
  const want = new Map(target.map((t, i) => [t.id, i]));
  const list = current.map((c) => c.id);
  const common = list.filter((id) => want.has(id));
  const stay = stayers(common, common.map((id) => want.get(id)!));
  let prev: string | null = null;
  for (const t of target) {
    const here = list.indexOf(t.id);
    if (here < 0) {
      const at = prev === null ? 0 : list.indexOf(prev) + 1;
      list.splice(at, 0, t.id);
      ops.insert(t, at);
    } else if (!stay.has(t.id)) {
      list.splice(here, 1);
      const at = prev === null ? 0 : list.indexOf(prev) + 1;
      list.splice(at, 0, t.id);
      ops.move(t.id, at);
    }
    prev = t.id;
  }
}

/** The operations that make the top-level elements of `owner` those of `target`. */
function elementOps(owner: string, current: readonly Element[], target: readonly Element[], out: DeckOp[]): void {
  if (same(current, target)) return;
  const have = new Map(current.map((e) => [e.id, e]));
  const wanted = new Set(target.map((e) => e.id));
  // what goes first, so that an element that moved into or out of a group is not in two places at once
  for (const e of current) if (!wanted.has(e.id)) out.push({ type: "remove_element", owner, id: e.id });
  for (const t of target) {
    const old = have.get(t.id);
    if (old && !same(old, t)) out.push({ type: "replace_element", owner, element: t });
  }
  const kept = current.filter((e) => wanted.has(e.id));
  reorder(kept, target, {
    insert: (item, index) => out.push({ type: "insert_element", owner, element: item, index }),
    move: (id, index) => out.push({ type: "move_element", owner, id, index }),
  });
}

const MASTER_FIELDS = ["id", "layouts", "elements"] as const;
const LAYOUT_FIELDS = ["id", "elements"] as const;

/**
 * The operations that turn `current` into `target`, for `VersionHistory.restore`. Only what differs is touched: a slide, a
 * layout or an element that is the same in both is left alone, so the restore merges with other people's edits like any edit.
 * Apply them in order with `deckReducer` (or `session.transact`) and the deck equals `target`, apart from the things named in
 * the file's description.
 */
export function restoreDeckOps(current: Deck, target: Deck): DeckOp[] {
  const ops: DeckOp[] = [];
  const emit = (op: DeckOp): void => {
    ops.push(op);
  };

  // ---- the deck itself
  const deckPatch: { title?: string; size?: Deck["size"] } = {};
  if (current.title !== target.title) deckPatch.title = target.title;
  if (!same(current.size, target.size)) deckPatch.size = target.size;
  if (Object.keys(deckPatch).length > 0) emit({ type: "set_deck", patch: deckPatch });
  if (!same(current.defaultTextStyle, target.defaultTextStyle)) emit({ type: "set_default_text", style: target.defaultTextStyle ?? null });

  // ---- masters and layouts that the version has and the deck doesn't come first, so that slides can point at them
  const haveMaster = new Map(current.masters.map((m) => [m.id, m]));
  const haveLayout = new Map<string, { master: Master; layout: Layout }>();
  for (const m of current.masters) for (const l of m.layouts) haveLayout.set(l.id, { master: m, layout: l });
  const wantLayout = new Set(target.masters.flatMap((m) => m.layouts.map((l) => l.id)));

  target.masters.forEach((m, index) => {
    if (haveMaster.has(m.id)) return;
    // layouts that belong to another master here are taken out of it first
    for (const l of m.layouts) if (haveLayout.has(l.id)) emit({ type: "remove_layout", id: l.id });
    emit({ type: "insert_master", master: m, index: Math.min(index, current.masters.length) });
  });
  for (const m of target.masters) {
    const old = haveMaster.get(m.id);
    if (!old) continue;
    const patch = diffPatch(old, m, MASTER_FIELDS);
    if (Object.keys(patch).length > 0) emit({ type: "patch_master", id: m.id, patch: patch as never });
    elementOps(m.id, old.elements, m.elements, ops);
    // layouts of this master: new ones are put in, changed ones patched; the ones the version doesn't have are removed after the slides moved
    m.layouts.forEach((l, index) => {
      const was = haveLayout.get(l.id);
      if (!was) {
        emit({ type: "insert_layout", master: m.id, layout: l, index: Math.min(index, old.layouts.length) });
        return;
      }
      const lp = diffPatch(was.layout, l, LAYOUT_FIELDS);
      if (Object.keys(lp).length > 0) emit({ type: "patch_layout", id: l.id, patch: lp as never });
      elementOps(l.id, was.layout.elements, l.elements, ops);
    });
  }

  // ---- slides
  const haveSlide = new Map(current.slides.map((s) => [s.id, s]));
  const wantSlide = new Set(target.slides.map((s) => s.id));
  for (const s of current.slides) if (!wantSlide.has(s.id)) emit({ type: "remove_slide", id: s.id });
  const kept = current.slides.filter((s) => wantSlide.has(s.id));
  // existing slides change first (they may move to a layout that now exists), then the order, with new slides put in place
  for (const t of target.slides) {
    const old = haveSlide.get(t.id);
    if (!old) continue;
    const patch = diffPatch(old, t, ["id", "elements"]);
    if (Object.keys(patch).length > 0) emit({ type: "patch_slide", id: t.id, patch: patch as never });
    elementOps(t.id, old.elements, t.elements, ops);
  }
  reorder<Slide>(kept, target.slides, {
    insert: (item, index) => emit({ type: "insert_slide", slide: item, index }),
    move: (id, index) => emit({ type: "move_slide", id, index }),
  });

  // ---- what the version no longer has: layouts (now unused), then masters
  for (const m of current.masters) {
    const keep = target.masters.find((x) => x.id === m.id);
    if (!keep) continue;
    for (const l of m.layouts) if (!keep.layouts.some((x) => x.id === l.id) && !target.masters.some((x) => x.layouts.some((y) => y.id === l.id))) emit({ type: "remove_layout", id: l.id });
  }
  for (const m of current.masters) if (!target.masters.some((x) => x.id === m.id)) emit({ type: "remove_master", id: m.id });

  // ---- layouts in the order of the version (looking at the deck as it is by now)
  const fixed = fixInserts(current, ops);
  let doc = current;
  for (const op of fixed) doc = deckReducer.apply(doc, op).state;
  for (const m of target.masters) {
    const now = doc.masters.find((x) => x.id === m.id);
    if (!now) continue;
    const have = now.layouts.map((l) => l.id);
    const order = m.layouts.map((l) => l.id);
    if (same(have, order)) continue;
    reorder(now.layouts, m.layouts, { insert: () => undefined, move: (id, index) => fixed.push({ type: "move_layout", id, index }) });
  }
  return fixed;
}

/**
 * Layouts a master gets while others are still to go can sit at an index past what the deck holds; and inserted things
 * can be placed before the ones that are only taken out later. Replaying the operations on the deck and clamping the indexes
 * makes each one valid at the moment it is applied.
 */
function fixInserts(current: Deck, ops: DeckOp[]): DeckOp[] {
  let doc = current;
  const out: DeckOp[] = [];
  for (const op of ops) {
    let fixed = op;
    if (op.type === "insert_layout") {
      const m = doc.masters.find((x) => x.id === op.master);
      if (m && op.index !== undefined && op.index > m.layouts.length) fixed = { ...op, index: m.layouts.length };
    } else if (op.type === "insert_master") {
      if (op.index !== undefined && op.index > doc.masters.length) fixed = { ...op, index: doc.masters.length };
    } else if (op.type === "insert_slide") {
      if (op.index > doc.slides.length) fixed = { ...op, index: doc.slides.length };
    } else if (op.type === "insert_element") {
      const owner = [...doc.slides, ...doc.masters, ...doc.masters.flatMap((m) => m.layouts)].find((x) => x.id === op.owner);
      if (owner && op.index !== undefined && op.index > owner.elements.length) fixed = { ...op, index: owner.elements.length };
    }
    doc = deckReducer.apply(doc, fixed).state;
    out.push(fixed);
  }
  return out;
}

// ---- Saying what changed -------------------------------------------------------------------------------------

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * What differs between two versions of a deck, for the history panel's "changes since this version": slides added, removed,
 * changed and moved, and the size, theme, masters and layouts if they changed. `lines` reads as "2 slides changed, 1 slide added".
 */
export function summarizeDeckDiff(from: Deck, to: Deck): DiffSummary {
  const before = new Map(from.slides.map((s) => [s.id, s]));
  const after = new Map(to.slides.map((s) => [s.id, s]));
  const added = to.slides.filter((s) => !before.has(s.id)).length;
  const removed = from.slides.filter((s) => !after.has(s.id)).length;
  const changed = to.slides.filter((s) => before.has(s.id) && !same(before.get(s.id), s)).length;
  const common = (list: readonly Slide[], other: Map<string, Slide>) => list.filter((s) => other.has(s.id)).map((s) => s.id);
  const moved = !same(common(from.slides, after), common(to.slides, before));
  const lines: string[] = [];
  if (changed) lines.push(`${plural(changed, "slide", "slides")} changed`);
  if (added) lines.push(`${plural(added, "slide", "slides")} added`);
  if (removed) lines.push(`${plural(removed, "slide", "slides")} removed`);
  if (moved) lines.push("slides reordered");
  let other = 0;
  if (from.title !== to.title) {
    other++;
    lines.push("title changed");
  }
  if (!same(from.size, to.size)) {
    other++;
    lines.push("slide size changed");
  }
  const themes = (d: Deck) => d.masters.map((m) => m.theme);
  if (!same(themes(from), themes(to))) {
    other++;
    lines.push("theme changed");
  }
  const rest = (d: Deck) => d.masters.map((m) => ({ ...m, theme: undefined }));
  if (!same(rest(from), rest(to))) {
    other++;
    lines.push("masters or layouts changed");
  }
  if (!same(from.defaultTextStyle, to.defaultTextStyle)) other++;
  return { added, removed, changed: changed + (moved ? 1 : 0) + other, lines: lines.map((l) => l.replace(/^./, (c) => c.toUpperCase())) };
}

/** What `VersionHistory` needs to know about decks: how to restore one, and how to say what changed. */
export const deckVersionSupport: VersionSupport<Deck, DeckOp> = {
  restoreOps: restoreDeckOps,
  summarize: summarizeDeckDiff,
};

// ---- A history for a deck session ----------------------------------------------------------------------------

/**
 * What is selected after a restore: the same things as far as they still exist. If the slide that was shown is gone, the slide
 * now at its position (or the last one) is shown, so the selection never points at nothing.
 */
export function selectionAfterRestore(selection: DeckSelection, before: Deck, after: Deck): DeckSelection {
  const owners = new Set([...after.slides.map((s) => s.id), ...after.masters.map((m) => m.id), ...after.masters.flatMap((m) => m.layouts.map((l) => l.id))]);
  let slide = selection.slide;
  if (slide !== null && !owners.has(slide)) {
    const at = before.slides.findIndex((s) => s.id === slide);
    slide = after.slides[Math.min(Math.max(at, 0), after.slides.length - 1)]?.id ?? null;
    return { slide, slides: slide ? [slide] : [], elements: [] };
  }
  const holder = [...after.slides, ...after.masters, ...after.masters.flatMap((m) => m.layouts)].find((x) => x.id === slide);
  const ids = new Set<string>();
  const walk = (list: readonly Element[]) => list.forEach((e) => (ids.add(e.id), e.type === "group" ? walk(e.children) : undefined));
  if (holder) walk(holder.elements);
  const next: DeckSelection = { slide, elements: selection.elements.filter((id) => ids.has(id)) };
  if (selection.slides) next.slides = selection.slides.filter((id) => after.slides.some((s) => s.id === id));
  return next;
}

export interface DeckVersionHistoryOptions {
  /** Where the versions are kept (`memoryVersionStorage`, or your own over a table, a bucket, a folder). */
  storage: VersionStorage<Deck>;
  /** Who is signed in and their role: saving and restoring need `editor`. */
  users: Users;
  /** The id the versions are kept under. Default: the deck's id (`session.deck.id`). */
  file?: string;
  /** The position in the shared log, for a shared file: `() => sync.version`. */
  version?: () => number | null;
  /** Keep the state before a restore as a version of its own (default true). */
  keepBeforeRestore?: boolean;
  /** Keep a version of the restore itself, as "Restored …" (default true). */
  keepAfterRestore?: boolean;
  /** Keep versions by itself now and then (see `AutoSaveOptions`). Call `history.dispose()` when the editor goes. */
  autoSave?: AutoSaveOptions;
  now?: () => number;
}

/**
 * A `VersionHistory` for a deck session, with `deckVersionSupport`. A restore is one undoable step (undo brings back the deck as
 * it was just before), the selection is kept where it still points at something, and with live editing the restore reaches
 * everyone as an ordinary change.
 *
 *     const history = deckVersionHistory(session, { storage, users });
 *     await history.save("Sent to the board");
 *     await history.restore(history.versions[0].id);
 */
export function deckVersionHistory(session: DeckSession, options: DeckVersionHistoryOptions): VersionHistory<Deck, DeckOp> {
  return new VersionHistory<Deck, DeckOp>({
    file: options.file ?? session.deck.id,
    session: {
      get state() {
        return session.deck;
      },
      transact(ops) {
        const before = session.deck;
        const after = ops.reduce((deck, op) => deckReducer.apply(deck, op).state, before);
        const selection = selectionAfterRestore(session.selection, before, after);
        session.transact(ops, { after: selection });
        session.selection = selection;
      },
      subscribe: (listener) => session.subscribe(listener),
    },
    storage: options.storage,
    users: options.users,
    support: deckVersionSupport,
    hash: hashDeck,
    version: options.version,
    keepBeforeRestore: options.keepBeforeRestore,
    keepAfterRestore: options.keepAfterRestore,
    autoSave: options.autoSave,
    now: options.now,
  });
}
