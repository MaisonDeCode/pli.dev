import type { Point, Selection } from "@pli.dev/docs";
import { BLOCK_ATTR, NON_TEXT_TYPES } from "./render";

/**
 * Translating between DOM selections and document selections.
 *
 * Every block element carries `data-block-id`, and its DOM text is exactly the block's text, so
 * a point inside a block is just "how many characters come before it in that block".
 */

export function blockElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[${BLOCK_ATTR}]`));
}

function blockId(el: Element): string {
  return el.getAttribute(BLOCK_ATTR)!;
}

/** The block element a node is in. A table doesn't count: it is a container, and its cells' blocks are the blocks. */
export function findBlockElement(root: HTMLElement, node: Node | null): HTMLElement | null {
  for (let n: Node | null = node; n && n !== root; n = n.parentNode) {
    if (n instanceof HTMLElement && n.hasAttribute(BLOCK_ATTR) && n.getAttribute("data-type") !== "table") return n;
  }
  return null;
}

function isNonText(el: HTMLElement): boolean {
  return NON_TEXT_TYPES.has(el.getAttribute("data-type") ?? "");
}

function offsetInBlock(el: HTMLElement, node: Node, offset: number): number {
  if (isNonText(el)) return 0;
  const range = el.ownerDocument.createRange();
  range.setStart(el, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

/**
 * Converts a DOM position to a document point. Positions between blocks (for example when the
 * whole editor is selected) snap to the nearest block.
 */
export function pointFromDom(root: HTMLElement, node: Node, offset: number): Point | null {
  const inside = findBlockElement(root, node);
  if (inside) return { block: blockId(inside), offset: offsetInBlock(inside, node, offset) };

  const blocks = blockElements(root);
  const last = blocks[blocks.length - 1];
  if (!last) return null;
  const range = root.ownerDocument.createRange();
  for (const el of blocks) {
    range.selectNodeContents(el);
    const position = range.comparePoint(node, offset);
    if (position < 0) return { block: blockId(el), offset: 0 };
    // A table holds other blocks; a position inside it but outside every cell block belongs to the
    // next cell block, found on the following iterations. Only the space just before it is the table.
    if (position === 0 && el.getAttribute("data-type") !== "table") {
      return { block: blockId(el), offset: offsetInBlock(el, node, offset) };
    }
  }
  return { block: blockId(last), offset: isNonText(last) ? 0 : (last.textContent ?? "").length };
}

export function selectionFromDom(root: HTMLElement): Selection | null {
  const dom = root.ownerDocument.getSelection();
  if (!dom || !dom.anchorNode || !dom.focusNode) return null;
  if (!root.contains(dom.anchorNode) || !root.contains(dom.focusNode)) return null;
  const anchor = pointFromDom(root, dom.anchorNode, dom.anchorOffset);
  const focus = pointFromDom(root, dom.focusNode, dom.focusOffset);
  return anchor && focus ? { anchor, focus } : null;
}

/**
 * Where, in its block's text, the tag that is shown by name begins, if a DOM position is inside one (and so hidden); otherwise
 * `null`. Of two tags side by side, it says which one the position is in.
 */
export function namedTagStart(root: HTMLElement, node: Node | null): number | null {
  const el = node instanceof Element ? node : node?.parentElement;
  const chip = el?.closest<HTMLElement>(".pli-ph[data-friendly]");
  const block = chip && findBlockElement(root, chip);
  if (!chip || !block) return null;
  const range = chip.ownerDocument.createRange();
  range.setStart(block, 0);
  range.setEnd(chip, 0);
  return range.toString().length;
}

/** Converts a static range (from a `beforeinput` event) to a document selection. */
export function selectionFromRange(
  root: HTMLElement,
  range: { startContainer: Node; startOffset: number; endContainer: Node; endOffset: number },
): Selection | null {
  const anchor = pointFromDom(root, range.startContainer, range.startOffset);
  const focus = pointFromDom(root, range.endContainer, range.endOffset);
  return anchor && focus ? { anchor, focus } : null;
}

function findBlock(root: HTMLElement, id: string): HTMLElement | null {
  return blockElements(root).find((el) => blockId(el) === id) ?? null;
}

/**
 * A tag shown by name keeps its text in the page, hidden. A point at its edge is put just outside it, in the paragraph, where the
 * caret is drawn, and not inside the hidden text, where it would not be.
 */
function outsideTag(node: Text, offset: number): { node: Node; offset: number } {
  const chip = node.parentElement?.closest<HTMLElement>(".pli-ph[data-friendly]");
  const parent = chip?.parentNode;
  if (!chip || !parent) return { node, offset };
  const edge = chip.getAttribute("data-edge");
  const texts: Text[] = [];
  const walker = chip.ownerDocument.createTreeWalker(chip, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) texts.push(n);
  const at = Array.prototype.indexOf.call(parent.childNodes, chip) as number;
  if (offset === 0 && node === texts[0] && (edge === "start" || edge === "both")) return { node: parent, offset: at };
  if (offset === node.data.length && node === texts[texts.length - 1] && (edge === "end" || edge === "both")) return { node: parent, offset: at + 1 };
  return { node, offset };
}

export function domPointFromPoint(root: HTMLElement, point: Point): { node: Node; offset: number } | null {
  const el = findBlock(root, point.block);
  if (!el) return null;
  if (isNonText(el)) {
    const parent = el.parentNode;
    return parent ? { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, el) } : null;
  }
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let passed = 0;
  let lastText: Text | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    lastText = n;
    if (point.offset <= passed + n.data.length) return outsideTag(n, point.offset - passed);
    passed += n.data.length;
  }
  // No text to land in: an empty block (just a <br>), or an offset past the end.
  return lastText ? { node: lastText, offset: lastText.data.length } : { node: el, offset: 0 };
}

function sameSelection(a: Selection, b: Selection): boolean {
  return (
    a.anchor.block === b.anchor.block &&
    a.anchor.offset === b.anchor.offset &&
    a.focus.block === b.focus.block &&
    a.focus.offset === b.focus.offset
  );
}

/**
 * Makes the browser's selection match `selection`. Does nothing if it already does, so it never
 * disturbs the user's own selection. Returns whether it changed anything. `force` sets it even when it matches in the document's
 * terms, for when the browser's is at a different place in the page (inside a hidden tag) for the same offset.
 */
export function applySelectionToDom(root: HTMLElement, selection: Selection, force = false): boolean {
  const current = selectionFromDom(root);
  if (!force && current && sameSelection(current, selection)) return false;
  const anchor = domPointFromPoint(root, selection.anchor);
  const focus = domPointFromPoint(root, selection.focus);
  const dom = root.ownerDocument.getSelection();
  if (!anchor || !focus || !dom) return false;
  dom.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
  return true;
}

/** Scrolls the focus end of the selection into view if it isn't. */
export function revealSelection(root: HTMLElement, selection: Selection): void {
  const focus = domPointFromPoint(root, selection.focus);
  if (!focus) return;
  const el = focus.node instanceof HTMLElement ? focus.node : focus.node.parentElement;
  el?.scrollIntoView?.({ block: "nearest" });
}

/** The text of a block as the browser currently has it. */
export function readBlockText(el: HTMLElement): string {
  return el.textContent ?? "";
}
