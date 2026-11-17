import { NOTE_FONT, NOTE_FONT_SIZE, isOpenable, isPlace, type NoteRun } from "@pli.dev/sheets";

/*
 * Between a note's runs and the editable HTML the note editor shows. Rendering turns runs into text and spans (a new line
 * is a <br>); reading goes the other way and understands what browsers make of typing (a <div> or <br> for Enter, a span
 * or <b> for a look), so the offsets the formatting commands use are always offsets in the note's own text.
 */

type Look = Omit<NoteRun, "text">;

const hex2 = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");

/** `#rrggbb` from the colours a style can hold (`rgb(…)`, `#rgb`, `#rrggbb`), or undefined. */
export function colorToHex(value: string): string | undefined {
  const v = value.trim().toLowerCase();
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  if (rgb) return `#${hex2(Number(rgb[1]))}${hex2(Number(rgb[2]))}${hex2(Number(rgb[3]))}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : undefined;
}

/** The css that gives a run its look. */
export function runCss(run: Omit<Look, "link">): string {
  const deco = [run.underline ? "underline" : "", run.strike ? "line-through" : ""].filter(Boolean).join(" ");
  return [
    run.bold ? "font-weight:bold" : "",
    run.italic ? "font-style:italic" : "",
    deco ? `text-decoration:${deco}` : "",
    run.color ? `color:${run.color}` : "",
    run.size ? `font-size:${run.size}pt` : "",
    run.font ? `font-family:${run.font.includes(" ") ? `'${run.font}'` : run.font}` : "",
  ]
    .filter(Boolean)
    .join(";");
}

/** Fills `root` with the runs: text, <span>s for the ones with a look, <br> for new lines. */
export function renderRuns(root: HTMLElement, runs: readonly NoteRun[]): void {
  root.textContent = "";
  const doc = root.ownerDocument;
  let endsWithBreak = false;
  for (const run of runs) {
    const parent = run.link ? doc.createElement("a") : Object.keys(run).length > 1 ? doc.createElement("span") : root;
    if (parent !== root) {
      const { link, text: _text, ...look } = run;
      parent.setAttribute("style", runCss(look));
      // The address is kept as data, not as href, so nothing in the editor can be navigated to by accident.
      if (link) parent.setAttribute("data-link", link);
      root.append(parent);
    }
    run.text.split("\n").forEach((part, i) => {
      if (i > 0) parent.append(doc.createElement("br"));
      if (part !== "") parent.append(doc.createTextNode(part));
    });
    endsWithBreak = run.text.endsWith("\n");
  }
  // A line break at the very end shows only when something follows it.
  if (endsWithBreak) root.append(doc.createElement("br"));
}

const BLOCKS = new Set(["DIV", "P", "LI", "UL", "OL", "H1", "H2", "H3", "BLOCKQUOTE", "PRE"]);

function lookOf(el: HTMLElement, base: Look): Look {
  const out: Look = { ...base };
  const tag = el.tagName;
  if (tag === "B" || tag === "STRONG") out.bold = true;
  if (tag === "I" || tag === "EM") out.italic = true;
  if (tag === "U") out.underline = true;
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") out.strike = true;
  if (tag === "A") {
    const to = (el.getAttribute("data-link") ?? el.getAttribute("href") ?? "").trim();
    if (to && (isOpenable(to) || isPlace(to))) out.link = to;
  }
  const st = el.style;
  if (st) {
    const weight = st.fontWeight;
    if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) out.bold = true;
    else if (weight === "normal" || (weight !== "" && Number(weight) < 600 && !Number.isNaN(Number(weight)))) delete out.bold;
    if (st.fontStyle === "italic" || st.fontStyle === "oblique") out.italic = true;
    else if (st.fontStyle === "normal") delete out.italic;
    const deco = st.textDecorationLine || st.textDecoration || "";
    if (deco) {
      if (/underline/.test(deco)) out.underline = true;
      else if (deco === "none") delete out.underline;
      if (/line-through/.test(deco)) out.strike = true;
      else if (deco === "none") delete out.strike;
    }
    if (st.color) {
      const c = colorToHex(st.color);
      if (c) out.color = c;
    }
    const size = /^([\d.]+)(pt|px)$/.exec(st.fontSize ?? "");
    if (size) {
      const pt = size[2] === "px" ? Number(size[1]) * 0.75 : Number(size[1]);
      if (pt > 0 && pt <= 409) out.size = Math.round(pt * 2) / 2;
    }
    const family = st.fontFamily?.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
    if (family && !/^(inherit|initial|unset)$/i.test(family)) out.font = family;
  }
  if (out.size === NOTE_FONT_SIZE) delete out.size;
  if (out.font === NOTE_FONT) delete out.font;
  return out;
}

interface Walk {
  runs: NoteRun[];
  length: number;
  /** A point in the DOM whose offset in the text is wanted, and the answer. */
  target?: { node: Node; offset: number };
  found?: number;
}

function push(w: Walk, text: string, look: Look): void {
  if (text === "") return;
  w.runs.push({ ...look, text });
  w.length += text.length;
}

function walk(node: Node, look: Look, w: Walk, root: Node): void {
  if (node.nodeType === 3) {
    const text = (node.nodeValue ?? "").replace(/\u00a0/g, " ");
    if (w.target && w.target.node === node) w.found = w.length + Math.min(w.target.offset, text.length);
    push(w, text, look);
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as HTMLElement;
  if (el.tagName === "BR") {
    // A <br> that ends a block is the placeholder browsers keep in an empty line, not a new line.
    const parent = el.parentElement;
    const placeholder = parent && parent !== root && BLOCKS.has(parent.tagName) && parent.lastChild === el;
    if (!placeholder) push(w, "\n", look);
    return;
  }
  const mine = lookOf(el, look);
  const block = el !== root && BLOCKS.has(el.tagName);
  // A block (what Enter makes in most browsers) starts a line of its own.
  if (block && w.length > 0) push(w, "\n", mine);
  const kids = el.childNodes;
  for (let i = 0; i < kids.length; i++) {
    if (w.target && w.target.node === el && w.target.offset === i) w.found = w.length;
    walk(kids[i]!, mine, w, root);
  }
  if (w.target && w.target.node === el && w.target.offset >= kids.length) w.found = w.length;
}

/** The runs the editor holds now (joined where they look alike), and the text. */
export function readRuns(root: HTMLElement): { text: string; runs: NoteRun[] } {
  const w: Walk = { runs: [], length: 0 };
  walk(root, {}, w, root);
  trimTrailingBreak(w, root);
  const joined: NoteRun[] = [];
  for (const r of w.runs) {
    const prev = joined[joined.length - 1];
    const keys = (x: NoteRun) => JSON.stringify({ ...x, text: "" });
    if (prev && keys(prev) === keys(r)) prev.text += r.text;
    else joined.push({ ...r });
  }
  return { text: joined.map((r) => r.text).join(""), runs: joined };
}

/** A last <br> with nothing after it is only there to show the line before it. */
function trimTrailingBreak(w: Walk, root: HTMLElement): void {
  const last = w.runs[w.runs.length - 1];
  if (last && last.text === "\n" && endsWithBr(root)) {
    w.runs.pop();
    w.length--;
  }
}

function endsWithBr(root: HTMLElement): boolean {
  let n: Node | null = root;
  while (n && n.lastChild) n = n.lastChild;
  return n !== null && n !== root && (n as HTMLElement).tagName === "BR";
}

/** The offset in the note's text of a point in the editor. */
export function textOffset(root: HTMLElement, node: Node, offset: number): number {
  const w: Walk = { runs: [], length: 0, target: { node, offset } };
  walk(root, {}, w, root);
  trimTrailingBreak(w, root);
  return Math.min(w.found ?? w.length, w.length);
}

/** The selection as offsets in the note's text, or null when it isn't in the editor. */
export function selectionOffsets(root: HTMLElement): { from: number; to: number } | null {
  const sel = root.ownerDocument.defaultView?.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  const a = textOffset(root, r.startContainer, r.startOffset);
  const b = textOffset(root, r.endContainer, r.endOffset);
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

/** Puts the selection between two offsets in the note's text. */
export function selectOffsets(root: HTMLElement, from: number, to: number): void {
  const doc = root.ownerDocument;
  const sel = doc.defaultView?.getSelection();
  if (!sel) return;
  const find = (target: number): { node: Node; offset: number } => {
    let acc = 0;
    const visit = (n: Node): { node: Node; offset: number } | null => {
      if (n.nodeType === 3) {
        const len = (n.nodeValue ?? "").length;
        if (target <= acc + len) return { node: n, offset: target - acc };
        acc += len;
        return null;
      }
      if (n.nodeType !== 1) return null;
      const el = n as HTMLElement;
      if (el.tagName === "BR") {
        if (target <= acc) return { node: el.parentNode!, offset: Array.prototype.indexOf.call(el.parentNode!.childNodes, el) };
        acc++;
        return null;
      }
      for (const kid of Array.from(el.childNodes)) {
        const hit = visit(kid);
        if (hit) return hit;
      }
      return null;
    };
    return visit(root) ?? { node: root, offset: root.childNodes.length };
  };
  const a = find(from);
  const b = from === to ? a : find(to);
  const range = doc.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Types plain text at the selection (pasting, and Enter), replacing what is selected. */
export function insertText(root: HTMLElement, text: string): void {
  const doc = root.ownerDocument;
  const sel = doc.defaultView?.getSelection();
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.getRangeAt(0).startContainer)) {
    root.append(doc.createTextNode(text));
    return;
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const frag = doc.createDocumentFragment();
  text.replace(/\r\n?/g, "\n").split("\n").forEach((part, i) => {
    if (i > 0) frag.append(doc.createElement("br"));
    if (part !== "") frag.append(doc.createTextNode(part));
  });
  const last = frag.lastChild;
  range.insertNode(frag);
  if (last) {
    range.setStartAfter(last);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

/**
 * The runs of pasted HTML: bold, italic, underline, strikethrough, colour, size, font and links are kept (with black text, and
 * the note's own font and size, taken as no look at all), and paragraphs become new lines. Scripts, images and styles are left
 * out. Empty when the HTML has no text.
 */
export function runsFromHtml(html: string): NoteRun[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, head, template, img, svg, iframe, object").forEach((n) => n.remove());
  const w: Walk = { runs: [], length: 0 };
  walk(doc.body, {}, w, doc.body);
  const out: NoteRun[] = [];
  for (const r of w.runs) {
    const run: NoteRun = { ...r, text: r.text.replace(/[\u0000-\u0009\u000b-\u001f]/g, "") };
    if (run.color === "#000000") delete run.color;
    if (run.text === "") continue;
    const prev = out[out.length - 1];
    const keys = (x: NoteRun) => JSON.stringify({ ...x, text: "" });
    if (prev && keys(prev) === keys(run)) prev.text += run.text;
    else out.push(run);
  }
  // Browsers wrap a copied stretch in blocks, which would otherwise start the text with a new line.
  if (out[0]) out[0] = { ...out[0], text: out[0].text.replace(/^\n+/, "") };
  const last = out[out.length - 1];
  if (last) last.text = last.text.replace(/\n+$/, "");
  return out.filter((r) => r.text !== "");
}
