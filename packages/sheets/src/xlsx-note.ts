import { attr, child, childrenNamed, textOf, type XmlElement } from "@pli.dev/core";
import { fileFont, familyHint, readFontName } from "./xlsx-fonts";
import { cellAddress, parseCell, parseRange } from "./address";
import { cleanLink, cleanNote, isPlace } from "./link";
import { axisOffsetPx, axisAtPx, readImage, sniffImage, toDataUri, type ImageType } from "./image";
import type { NoteBox, NoteDash, NoteRun, Sheet } from "./model";
import { NOTE_DASHES, NOTE_FILL, NOTE_FONT, NOTE_FONT_SIZE, NOTE_LINE_WEIGHT, cleanAuthor, cleanNoteBox, cleanNoteRuns, joinRuns, noteBoxFromPx, noteBoxPx, noteRunsOf, runsText } from "./note";
import { colorOf } from "./xlsx-format";

/*
 * Links and notes in an .xlsx file. A link is a `hyperlink` in the sheet: a web address or a file is a relationship of the
 * sheet (marked External), a place in the workbook is the `location` attribute. A note is a `comment` in a comments part,
 * and, for the box Excel draws, a shape in a legacy VML drawing that the sheet also points at.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const MAX_RANGE_CELLS = 20_000;
/** The author written on notes that have none of their own: the file wants one, and a note read back with this one has no author. */
export const ANONYMOUS_AUTHOR = "Pli";

const sorted = (sheet: Sheet, pick: (c: NonNullable<Sheet["cells"][string]>) => boolean) =>
  Object.entries(sheet.cells)
    .filter(([, c]) => pick(c))
    .map(([address, cell]) => ({ address, cell, pos: parseCell(address)! }))
    .sort((a, b) => a.pos.row - b.pos.row || a.pos.col - b.pos.col);

/** The `hyperlinks` element of a sheet. `relate` gives the relationship id for an address outside the workbook. */
export function hyperlinksXml(sheet: Sheet, relate: (target: string) => string): string {
  const links = sorted(sheet, (c) => c.link !== undefined);
  if (!links.length) return "";
  const items = links.map(({ address, cell }) => {
    const link = cell.link!;
    const where = isPlace(link.to) ? ` location="${esc(link.to.slice(1))}"` : ` r:id="${relate(link.to)}"`;
    return `<hyperlink ref="${address}"${where}${link.tip ? ` tooltip="${esc(link.tip)}"` : ""}/>`;
  });
  return `<hyperlinks>${items.join("")}</hyperlinks>`;
}

/** Reads a sheet's links onto its cells. `target` gives where a relationship points. */
export function readHyperlinks(root: XmlElement, target: (id: string) => string | undefined, sheet: Sheet, warnings: Set<string>, theme?: readonly string[]): void {
  for (const h of childrenNamed(child(root, "hyperlinks"), "hyperlink")) {
    const id = attr(h, "id", "r");
    const address = id ? target(id) ?? "" : "";
    const location = attr(h, "location") ?? "";
    const to = address ? (location ? `${address}#${location}` : address) : location ? `#${location}` : "";
    if (!to) continue;
    let link;
    try {
      link = cleanLink({ to, ...(attr(h, "tooltip") ? { tip: attr(h, "tooltip")! } : {}) });
    } catch {
      warnings.add("A link that runs a script, or has no address, was left out");
      continue;
    }
    const ref = (attr(h, "ref") ?? "").replace(/\$/g, "");
    const range = parseRange(ref) ?? (() => { const p = parseCell(ref); return p ? { r1: p.row, c1: p.col, r2: p.row, c2: p.col } : null; })();
    if (!range) continue;
    let count = 0;
    for (let r = range.r1; r <= range.r2 && count < MAX_RANGE_CELLS; r++)
      for (let c = range.c1; c <= range.c2 && count < MAX_RANGE_CELLS; c++, count++) {
        const key = cellAddress(r, c);
        // Text in the theme's hyperlink colour is a link with the look a link has (it follows the theme); in the followed-hyperlink colour, one that was followed.
        const own = sheet.cells[key];
        const color = own?.s?.color?.toLowerCase();
        // Excel for Mac writes the Office 2013 colours (0563C1, 954F72) as plain colours when it flattens its Hyperlink style, whatever the theme says.
        const kind = theme && color ? (color === `#${theme[10]?.toLowerCase()}` || color === "#0563c1" ? 10 : color === `#${theme[11]?.toLowerCase()}` || color === "#954f72" ? 11 : 0) : 0;
        if (kind) {
          const { color: _gone, ...rest } = own!.s!;
          const { s: _s, ...cell } = own!;
          sheet.cells[key] = { ...cell, ...(Object.keys(rest).length ? { s: rest } : {}), link: kind === 11 ? { ...link, followed: true } : link };
        } else sheet.cells[key] = { ...own, link };
      }
  }
}

const textEl = (el: XmlElement) => textOf(el).replace(/\r\n?/g, "\n");

/** The look a `rPr` (the properties of one run of a comment) gives, leaving out Excel's own defaults for notes. */
function runLook(rPr: XmlElement | undefined, theme: readonly string[]): Omit<NoteRun, "text"> {
  const out: Omit<NoteRun, "text"> = {};
  if (!rPr) return out;
  const on = (name: string) => {
    const el = child(rPr, name);
    return !!el && attr(el, "val") !== "0" && attr(el, "val") !== "false";
  };
  if (on("b")) out.bold = true;
  if (on("i")) out.italic = true;
  if (on("strike")) out.strike = true;
  const u = child(rPr, "u");
  if (u && attr(u, "val") !== "none") out.underline = true;
  const colorEl = child(rPr, "color");
  // Indexed 81 is the colour a note's text has unless told otherwise.
  const color = attr(colorEl, "indexed") === "81" ? undefined : colorOf(colorEl, theme);
  if (color && color !== "#000000") out.color = color;
  const sz = Number(attr(child(rPr, "sz"), "val"));
  const font = readFontName(rPr, "rFont");
  // The look Excel gives a note's text when nothing was chosen: Tahoma 9 in Windows, and the workbook's own font (Calibri or Aptos 11) in Excel for Mac.
  const plain = !!font && ((font === NOTE_FONT && sz === NOTE_FONT_SIZE) || (/^(Calibri|Aptos|Aptos Narrow)$/.test(font) && sz === 11));
  if (!plain) {
    if (sz > 0 && sz !== NOTE_FONT_SIZE) out.size = sz;
    if (font && font !== NOTE_FONT) out.font = font;
  }
  return out;
}

/** The runs of a comment's text, without the phonetic ones: each with the look it was given. */
function commentRuns(text: XmlElement | undefined, theme: readonly string[]): NoteRun[] {
  const runs: NoteRun[] = [];
  for (const el of text?.children ?? []) {
    if (typeof el === "string") continue;
    if (el.name === "t") runs.push({ text: textEl(el) });
    else if (el.name === "r") runs.push({ ...runLook(child(el, "rPr"), theme), text: textEl(child(el, "t") ?? el) });
  }
  return joinRuns(runs);
}

/** The runs without their first `n` characters. */
function cutStart(runs: NoteRun[], n: number): NoteRun[] {
  const out: NoteRun[] = [];
  let left = n;
  for (const r of runs) {
    if (left >= r.text.length) {
      left -= r.text.length;
      continue;
    }
    out.push({ ...r, text: r.text.slice(left) });
    left = 0;
  }
  return out;
}

/** Reads a comments part onto the cells as notes (with the boxes in `vml`, the legacy drawing that goes with it). Threaded comments, which are another thing, are left out. */
export function readNotes(comments: XmlElement | undefined, sheet: Sheet, warnings: Set<string>, vml?: string, theme: readonly string[] = [], image?: (id: string) => Uint8Array | undefined, threadedRead = false): void {
  if (!comments) return;
  const authors = childrenNamed(child(comments, "authors"), "author").map((a) => textOf(a));
  const boxes = vml ? readBoxes(vml, sheet, warnings, image) : new Map<string, NoteBox>();
  for (const c of childrenNamed(child(comments, "commentList"), "comment")) {
    const pos = parseCell((attr(c, "ref") ?? "").replace(/\$/g, ""));
    if (!pos) continue;
    let runs = commentRuns(child(c, "text"), theme);
    if (runsText(runs).startsWith("[Threaded comment]")) {
      if (!threadedRead) warnings.add("Threaded comments are not supported yet and were left out");
      continue;
    }
    // Excel writes the author in front, in bold, as a line of its own.
    let author: string | undefined = authors[Number(attr(c, "authorId") ?? 0)];
    if (author === ANONYMOUS_AUTHOR || author?.startsWith("tc=")) author = undefined;
    if (author && runsText(runs).startsWith(`${author}:`)) {
      const full = runsText(runs);
      const gap = full.slice(author.length + 1).match(/^\r?\n/)?.[0].length ?? 0;
      runs = cutStart(runs, author.length + 1 + gap);
    }
    const text = runsText(runs);
    let note: string | null;
    try {
      note = cleanNote(text);
    } catch {
      continue;
    }
    if (note === null) continue;
    const key = cellAddress(pos.row, pos.col);
    const cell = { ...sheet.cells[key], note } as NonNullable<Sheet["cells"][string]>;
    try {
      const clean = cleanNoteRuns(note, runs);
      if (clean) cell.noteRuns = clean;
    } catch {
      /* the text is kept, without its look */
    }
    const a = cleanAuthor(author);
    if (a) cell.noteAuthor = a;
    const box = boxes.get(key);
    if (box) cell.noteBox = box;
    sheet.cells[key] = cell;
  }
}

// ---- the boxes: shapes of the legacy (VML) drawing ----

/** A length in a style, as pixels: 144pt, 2in, 3.5cm, 200px. */
function lengthPx(value: string | undefined): number | undefined {
  const m = /^\s*(-?[\d.]+)\s*(pt|px|in|cm|mm)?\s*$/i.exec(value ?? "");
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = (m[2] ?? "px").toLowerCase();
  return n * (unit === "pt" ? 4 / 3 : unit === "in" ? 96 : unit === "cm" ? 96 / 2.54 : unit === "mm" ? 96 / 25.4 : 1);
}

const NAMED_COLORS: Record<string, string> = {
  infobackground: "#ffffe1", infotext: "#000000", window: "#ffffff", windowtext: "#000000", buttonface: "#c0c0c0", buttontext: "#000000",
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", lime: "#00ff00", aqua: "#00ffff", cyan: "#00ffff",
  fuchsia: "#ff00ff", magenta: "#ff00ff", silver: "#c0c0c0", gray: "#808080", grey: "#808080", maroon: "#800000", olive: "#808000", navy: "#000080",
  purple: "#800080", teal: "#008080", orange: "#ffa500",
};

/** A VML colour (`#ffffe1`, `#fe1`, `red`, `infoBackground [80]`, `rgb(1,2,3)`) as `#rrggbb`, or undefined. */
export function vmlColor(value: string | undefined): string | undefined {
  const v = (value ?? "").replace(/\[\d+\]/, "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(v);
  if (rgb) return "#" + [rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("");
  return NAMED_COLORS[v];
}

/** A VML length as points: `2pt`, `3px`, `0.5in`, or (as in `strokeweight`) a plain number of EMU. */
function vmlPoints(value: string | undefined): number | undefined {
  const m = /^\s*(-?[\d.]+)\s*(pt|px|in|cm|mm)?\s*$/i.exec(value ?? "");
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = m[2]?.toLowerCase();
  return unit === undefined ? n / 12700 : unit === "pt" ? n : unit === "px" ? n * 0.75 : unit === "in" ? n * 72 : unit === "cm" ? (n * 72) / 2.54 : (n * 72) / 25.4;
}

/** The value of an attribute (`name` may carry a prefix, as in `o:relid`) in the text of a start tag. */
function tagAttr(tag: string | undefined, name: string): string | undefined {
  if (!tag) return undefined;
  const m = new RegExp(`(?:^|[\\s"'])${name.replace(/[:.]/g, "\\$&")}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? m[1] ?? m[2] : undefined;
}

const DASH_BY_VML = new Map<string, NoteDash>(NOTE_DASHES.map((d) => [d.toLowerCase(), d]));

/** A fraction from VML's `opacity`: `0.5`, `.5`, `50%` or `32768f` (65536ths). */
function vmlFraction(value: string | undefined): number | undefined {
  const t = (value ?? "").trim();
  const n = parseFloat(t);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(1, t.endsWith("f") ? n / 65536 : t.endsWith("%") ? n / 100 : n));
}

/** The fill, picture, line and shadow a note's shape has, leaving out what is Excel's usual for a note. */
function readLook(shape: string, warnings: Set<string>, image?: (id: string) => Uint8Array | undefined): Partial<NoteBox> {
  const open = /<v:shape\b[^>]*>/i.exec(shape)?.[0];
  const fillTag = /<v:fill\b[^>]*>/i.exec(shape)?.[0];
  const strokeTag = /<v:stroke\b[^>]*>/i.exec(shape)?.[0];
  const shadowTag = /<v:shadow\b[^>]*>/i.exec(shape)?.[0];
  const out: Record<string, unknown> = {};
  const off = (v: string | undefined) => /^(f|false|0|no)$/i.test((v ?? "").trim());
  const fill = vmlColor(tagAttr(fillTag, "color")) ?? vmlColor(tagAttr(open, "fillcolor"));
  if (fill && fill !== NOTE_FILL) out["fill"] = fill;
  const opacity = vmlFraction(tagAttr(fillTag, "opacity"));
  if (opacity !== undefined && opacity < 1) out["transparency"] = Math.round((1 - opacity) * 100);
  if (off(tagAttr(open, "filled")) || off(tagAttr(fillTag, "on"))) out["transparency"] = 100;
  const type = (tagAttr(fillTag, "type") ?? "").toLowerCase();
  const relid = tagAttr(fillTag, "o:relid") ?? tagAttr(fillTag, "r:id") ?? (/<v:imagedata\b[^>]*>/i.exec(shape)?.[0] ? tagAttr(/<v:imagedata\b[^>]*>/i.exec(shape)![0], "o:relid") : undefined);
  if ((type === "frame" || type === "tile") && relid) {
    const bytes = image?.(relid);
    const info = bytes ? sniffImage(bytes) : null;
    if (bytes && info) {
      try {
        const src = toDataUri(bytes, info.type);
        readImage(src);
        out["picture"] = src;
      } catch {
        warnings.add("A picture filling a note's box is too big or not one Pli keeps, and was left out");
      }
    } else warnings.add("A picture filling a note's box is of a kind Pli doesn't keep, and was left out");
  }
  if (off(tagAttr(open, "stroked")) || off(tagAttr(strokeTag, "on"))) out["line"] = "none";
  else {
    const line = vmlColor(tagAttr(strokeTag, "color")) ?? vmlColor(tagAttr(open, "strokecolor"));
    if (line && line !== "#000000") out["line"] = line;
  }
  const weight = vmlPoints(tagAttr(strokeTag, "weight")) ?? vmlPoints(tagAttr(open, "strokeweight"));
  if (weight && weight > 0 && Math.round(weight * 4) / 4 !== NOTE_LINE_WEIGHT) out["lineWeight"] = Math.min(100, Math.max(0.25, Math.round(weight * 4) / 4));
  const dash = DASH_BY_VML.get((tagAttr(strokeTag, "dashstyle") ?? "").trim().toLowerCase().replace(/\s+/g, ""));
  if (dash && dash !== "solid") out["dash"] = dash;
  // Excel's notes say `<v:shadow on="t">` for a shadow, and leave `on` out when it is switched off (VML's default is off): only a shadow that is off is a look of its own.
  if (shadowTag && (off(tagAttr(shadowTag, "on")) || tagAttr(shadowTag, "on") === undefined)) out["shadow"] = false;
  return out as Partial<NoteBox>;
}

/**
 * The size, place and visibility the VML drawing gives each note, by cell. The drawing is scanned as text, not parsed, as
 * Excel's is not always well-formed. The place comes from the anchor (cells and offsets), the size from the anchor or else
 * the shape's style.
 */
function readBoxes(vml: string, sheet: Sheet, warnings: Set<string>, image?: (id: string) => Uint8Array | undefined): Map<string, NoteBox> {
  const out = new Map<string, NoteBox>();
  for (const m of vml.matchAll(/<v:shape\b[^>]*>[\s\S]*?<\/v:shape>/gi)) {
    const shape = m[0];
    if (!/ObjectType\s*=\s*["']Note["']/i.test(shape)) continue;
    const row = /<x:Row>\s*(\d+)\s*<\/x:Row>/i.exec(shape)?.[1];
    const col = /<x:Column>\s*(\d+)\s*<\/x:Column>/i.exec(shape)?.[1];
    if (row === undefined || col === undefined) continue;
    const key = cellAddress(Number(row) + 1, Number(col) + 1);
    const style: Record<string, string> = {};
    for (const part of (/<v:shape\b[^>]*?\bstyle\s*=\s*"([^"]*)"/i.exec(shape)?.[1] ?? "").split(";")) {
      const i = part.indexOf(":");
      if (i > 0) style[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
    }
    const show = /<x:Visible\b[^>]*\/>|<x:Visible>\s*(?!False)[^<]*<\/x:Visible>/i.test(shape) || /^visible$/i.test(style["visibility"] ?? "");
    const cellRight = axisOffsetPx(sheet, "col", Number(col) + 2);
    const cellTop = axisOffsetPx(sheet, "row", Number(row) + 1);
    const anchor = (/<x:Anchor>([^<]*)<\/x:Anchor>/i.exec(shape)?.[1] ?? "").split(",").map((n) => Number(n.trim()));
    let px: { left: number; top: number; width: number; height: number };
    if (anchor.length >= 8 && anchor.every((n) => Number.isFinite(n))) {
      const [c1, x1, r1, y1, c2, x2, r2, y2] = anchor as [number, number, number, number, number, number, number, number];
      const left = axisOffsetPx(sheet, "col", c1 + 1) + x1;
      const top = axisOffsetPx(sheet, "row", r1 + 1) + y1;
      px = { left, top, width: axisOffsetPx(sheet, "col", c2 + 1) + x2 - left, height: axisOffsetPx(sheet, "row", r2 + 1) + y2 - top };
    } else {
      const def = noteBoxPx(cellRight, cellTop, undefined);
      px = { left: def.left, top: def.top, width: lengthPx(style["width"]) ?? def.width, height: lengthPx(style["height"]) ?? def.height };
    }
    if (!(px.width > 0) || !(px.height > 0)) continue;
    let box = noteBoxFromPx(cellRight, cellTop, px, show);
    const look = readLook(shape, warnings, image);
    if (Object.keys(look).length) {
      try {
        box = cleanNoteBox({ ...box, ...look });
      } catch {
        warnings.add("The fill or line of a note's box could not be read and was left out");
      }
    }
    if (box) out.set(key, box);
  }
  return out;
}

/** A run's font: `rFont` and the family hint after it (Excel's order). */
function noteFontXml(name: string): string {
  const written = fileFont(name);
  return `<rFont val="${esc(written)}"/><family val="${familyHint(written)}"/>`;
}

/** The text of a note, as the runs of a comment: with the author in bold in front (Excel's way) when there is one. */
function commentXml(cell: NonNullable<Sheet["cells"][string]>, author: string | undefined): string {
  if (!cell.noteRuns && !author) return `<text><t xml:space="preserve">${esc(cell.note!)}</t></text>`;
  const runs: NoteRun[] = [...(author ? [{ text: `${author}:`, bold: true as const }, { text: "\n" }] : []), ...noteRunsOf(cell)];
  const rich = runs.map((r) => {
    const props =
      (r.bold ? "<b/>" : "") + (r.italic ? "<i/>" : "") + (r.strike ? "<strike/>" : "") + (r.underline ? "<u/>" : "") +
      `<sz val="${r.size ?? NOTE_FONT_SIZE}"/>` +
      (r.color ? `<color rgb="FF${r.color.slice(1).toUpperCase()}"/>` : '<color indexed="81"/>') +
      noteFontXml(r.font ?? NOTE_FONT);
    return `<r><rPr>${props}</rPr><t xml:space="preserve">${esc(r.text)}</t></r>`;
  });
  return `<text>${rich.join("")}</text>`;
}

const pt = (px: number) => Math.round(px * 75) / 100;

/**
 * The files a sheet's notes need: the comments part, and the drawing that gives each its box. `block` is the number of the
 * sheet in the workbook, which keeps the shape numbers of the sheets apart.
 */
export function notesParts(sheet: Sheet, block: number, firstMedia = 1): { comments: string; drawing: string; rels?: string; media: { name: string; bytes: Uint8Array; type: ImageType }[] } | null {
  const notes = sorted(sheet, (c) => c.note !== undefined);
  if (!notes.length) return null;
  const authors: string[] = [];
  const authorId = (name: string | undefined) => {
    const n = name ?? ANONYMOUS_AUTHOR;
    let i = authors.indexOf(n);
    if (i < 0) i = authors.push(n) - 1;
    return i;
  };
  const items = notes.map(({ address, cell }) => `<comment ref="${address}" authorId="${authorId(cell.noteAuthor)}">${commentXml(cell, cell.noteAuthor?.startsWith("tc=") ? undefined : cell.noteAuthor)}</comment>`);
  const comments =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors>${authors.map((a) => `<author>${esc(a)}</author>`).join("")}</authors><commentList>` +
    items.join("") +
    `</commentList></comments>`;
  const media: { name: string; bytes: Uint8Array; type: ImageType }[] = [];
  const rels: string[] = [];
  const shapes = notes.map(({ cell, pos }, i) => {
    const row = pos.row - 1;
    const col = pos.col - 1;
    const px = noteBoxPx(axisOffsetPx(sheet, "col", pos.col + 1), axisOffsetPx(sheet, "row", pos.row), cell.noteBox);
    const a = axisAtPx(sheet, "col", px.left);
    const b = axisAtPx(sheet, "col", px.left + px.width);
    const c = axisAtPx(sheet, "row", px.top);
    const d = axisAtPx(sheet, "row", px.top + px.height);
    const shown = !!cell.noteBox?.show;
    const look = cell.noteBox;
    const fill = look?.fill ?? NOTE_FILL;
    // A picture fill is a file the drawing points at by relationship.
    let relid = "";
    if (look?.picture) {
      const { type, bytes } = readImage(look.picture);
      const name = `image${firstMedia + media.length}.${type}`;
      media.push({ name, bytes, type });
      relid = `rId${media.length}`;
      rels.push(`<Relationship Id="${relid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${name}"/>`);
    }
    const opacity = look?.transparency ? ` opacity="${Math.round((100 - look.transparency) * 655.36)}f"` : "";
    const fillTag = relid ? `<v:fill o:title="${esc(media[media.length - 1]!.name)}" color2="${fill}"${opacity} recolor="t" rotate="t" type="frame" o:relid="${relid}"/>` : `<v:fill color2="${fill}"${opacity}/>`;
    const strokeAttrs = (look?.line === "none" ? ' stroked="f"' : look?.line ? ` strokecolor="${look.line}"` : "") + (look?.lineWeight ? ` strokeweight="${look.lineWeight}pt"` : "");
    const strokeTag = look?.dash ? `<v:stroke dashstyle="${look.dash.toLowerCase()}"/>` : "";
    return (
      `<v:shape id="_x0000_s${block * 1024 + 1 + i}" type="#_x0000_t202" style="position:absolute;margin-left:${pt(px.left)}pt;margin-top:${pt(px.top)}pt;width:${pt(px.width)}pt;height:${pt(px.height)}pt;z-index:${i + 1};visibility:${shown ? "visible" : "hidden"}" fillcolor="${fill}"${strokeAttrs} o:insetmode="auto">` +
      `${fillTag}${strokeTag}<v:shadow${look?.shadow === false ? "" : ' on="t"'} color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>` +
      `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${a.index - 1}, ${Math.round(a.off)}, ${c.index - 1}, ${Math.round(c.off)}, ${b.index - 1}, ${Math.round(b.off)}, ${d.index - 1}, ${Math.round(d.off)}</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${row}</x:Row><x:Column>${col}</x:Column>${shown ? "<x:Visible/>" : ""}</x:ClientData></v:shape>`
    );
  });
  const drawing =
    `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">` +
    `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${block}"/></o:shapelayout>` +
    `<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>` +
    shapes.join("") +
    `</xml>`;
  return {
    comments,
    drawing,
    media,
    ...(rels.length ? { rels: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>` } : {}),
  };
}
