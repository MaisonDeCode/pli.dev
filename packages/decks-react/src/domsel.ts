import type { TextPos, TextRange } from "@pli.dev/decks";

/** Where a DOM position is in the text of an editable body (paragraphs carry `data-p`, their text sits in `[data-runs]`). */
export function domToPos(body: HTMLElement, node: Node | null, offset: number): TextPos | null {
  if (!node || !body.contains(node)) return null;
  const paras = [...body.querySelectorAll<HTMLElement>(":scope > [data-p]")];
  if (node === body) {
    if (paras.length === 0) return { p: 0, o: 0 };
    const i = Math.min(offset, paras.length - 1);
    return { p: i, o: offset >= paras.length ? textOf(paras[i]!).length : 0 };
  }
  const para = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-p]");
  if (!para || !body.contains(para)) return null;
  const p = Number(para.dataset.p);
  const runs = para.querySelector<HTMLElement>("[data-runs]");
  if (!runs) return { p, o: 0 };
  if (!runs.contains(node) && node !== runs) {
    // in the bullet, or on the paragraph itself
    if (node === para) return { p, o: offset >= para.childNodes.length ? textOf(para).length : 0 };
    return { p, o: 0 };
  }
  const range = document.createRange();
  range.setStart(runs, 0);
  range.setEnd(node, offset);
  return { p, o: range.toString().length };
}

export function textOf(para: HTMLElement): string {
  return para.querySelector<HTMLElement>("[data-runs]")?.textContent ?? "";
}

/** The DOM position for a text position. At the boundary between runs it picks the end of the earlier run. */
export function posToDom(body: HTMLElement, pos: TextPos): { node: Node; offset: number } | null {
  const para = body.querySelector<HTMLElement>(`:scope > [data-p="${pos.p}"]`);
  if (!para) return null;
  const runs = para.querySelector<HTMLElement>("[data-runs]") ?? para;
  const walker = document.createTreeWalker(runs, NodeFilter.SHOW_TEXT);
  let at = 0;
  let last: Text | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.data.length;
    if (pos.o <= at + len) return { node: n, offset: Math.max(0, pos.o - at) };
    at += len;
    last = n;
  }
  if (last) return { node: last, offset: last.data.length };
  return { node: runs, offset: 0 };
}

export function readSelection(body: HTMLElement): TextRange | null {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0) return null;
  const a = domToPos(body, sel.anchorNode, sel.anchorOffset);
  const f = domToPos(body, sel.focusNode, sel.focusOffset);
  if (!a || !f) return null;
  return { from: a, to: f };
}

export function writeSelection(body: HTMLElement, range: TextRange): void {
  const sel = window.getSelection();
  if (!sel) return;
  const a = posToDom(body, range.from);
  const f = posToDom(body, range.to);
  if (!a || !f) return;
  const same = sel.anchorNode === a.node && sel.anchorOffset === a.offset && sel.focusNode === f.node && sel.focusOffset === f.offset;
  if (same) return;
  try {
    sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
  } catch {
    // a position that no longer exists (the text changed under us): leave the selection alone
  }
}

/** Plain text of pasted HTML, with a line break after each block. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) out.push((n.textContent ?? "").replace(/\s+/g, " "));
    else if (n instanceof HTMLElement) {
      if (n.tagName === "BR") out.push("\n");
      else if (/^(STYLE|SCRIPT|HEAD|TITLE)$/.test(n.tagName)) return;
      else {
        n.childNodes.forEach(walk);
        if (/^(P|DIV|LI|H[1-6]|TR|BLOCKQUOTE|PRE|UL|OL)$/.test(n.tagName)) out.push("\n");
      }
    }
  };
  doc.body.childNodes.forEach(walk);
  return out.join("").replace(/\n{2,}/g, "\n").replace(/^\n+|\n+$/g, "");
}
