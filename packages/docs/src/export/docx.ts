import { zipSync, strToU8 } from "fflate";
import { officeHint, officeSubstitute, type Thread } from "@pli.dev/core";
import { isFloating } from "../model";
import type { Align, Block, BoxStyle, Doc, DocAnchor, FloatPlacement, HeadingBlock, ImageBlock, ListItemBlock, ListMarker, Marks, PageSetup, ParagraphFormat, Run, TableBlock, TocBlock } from "../model";
import { colSpanOf, originMap, rowSpanOf } from "../grid";
import { pageDimensions, pageSetupOf, PX_PER_INCH } from "../page";
import { commentRanges } from "../comments";
import { defaultMarker, listNumbers, markerOf } from "../lists";
import { plainText } from "../runs";
import { activeRegionNames, regionVariant } from "../regions";
import { hasFirstPageRegions, sectionShape, sectionsOf, startsOnNewPage, type ColumnSetup } from "../sections";
import { FOOTNOTE_SELF, footnoteIds } from "../footnotes";
import { effectiveMarks, resolveStyle, withParagraphStyle } from "../styles";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const NS_WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MAX_LEVEL = 8;
const EMU_PER_PX = 9525;
const TWIPS_PER_PT = 20;

// XML 1.0 forbids most control characters, even escaped.
const INVALID_XML = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]", "g");

function esc(value: string): string {
  return value
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function hex(color: string): string | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(color) ?? /^#?([0-9a-f]{3})$/i.exec(color);
  if (!m) return undefined;
  const h = m[1]!;
  return (h.length === 3 ? [...h].map((c) => c + c).join("") : h).toUpperCase();
}

const HIGHLIGHT_NAMES: Record<string, string> = {
  FFFF00: "yellow",
  "00FF00": "green",
  "00FFFF": "cyan",
  FF00FF: "magenta",
  "0000FF": "blue",
  FF0000: "red",
};

/** State shared by every part of the package, so ids and file names never collide. */
interface Shared {
  nextImage: number;
  nextDocPr: number;
  /** The numbering definitions the lists use, and the instances of them: each numbered list that starts or restarts is its own instance. */
  numbering: NumberingState;
  media: { name: string; bytes: Uint8Array }[];
  hasToc: boolean;
  maxImageWidthPx: number;
  /** Width of the text area, in twips (1/1440 inch), for sizing tables. */
  textWidthTwips: number;
  /** Word's number for each footnote, by our id: 1, 2, 3 in the order the references appear. */
  footnoteIds: Map<string, number>;
  /** The comment threads being written, by our id: Word's id for each of its comments, and how many ranges of text it covers. */
  comments: Map<string, { word: number[]; total: number; seen: number }>;
  /** The id each of the document's named styles has in `styles.xml`, by our id. */
  styleIds: Map<string, string>;
  /** The next id for a tracked change, and the name each suggestion's author goes by. */
  revision: number;
  authorName: (userId: string) => string;
  /** The font families written so far (for `fontTable.xml`), and whether non-Office ones are swapped for an Office stand-in. */
  fonts: FontUse;
}

/** The families a file names, collected as its parts are written. */
interface FontUse {
  mode: "keep" | "office";
  names: Set<string>;
}

/** The family to write for `name` (the Office stand-in with `fonts: "office"`), noted for the font table. */
function fontName(fonts: FontUse | undefined, name: string): string {
  const clean = name.replace(INVALID_XML, "").trim();
  const written = fonts?.mode === "office" ? officeSubstitute(clean) : clean;
  fonts?.names.add(written);
  return written;
}

/**
 * `word/fontTable.xml`: every family the file names, each with what Word needs to pick a similar font on a computer
 * that doesn't have it (`altName`, the family kind and the pitch). Office's own fonts need no stand-in. The children of
 * a font come in the order the schema gives: altName, charset, family, pitch.
 */
function fontTableXml(names: Iterable<string>): string {
  const fonts = [...names].map((name) => {
    const hint = officeHint(name);
    const stand = officeSubstitute(name);
    const alt = stand !== name ? `<w:altName w:val="${esc(stand)}"/>` : "";
    return `<w:font w:name="${esc(name)}">${alt}<w:family w:val="${hint.docxFamily}"/><w:pitch w:val="${hint.docxPitch}"/></w:font>`;
  });
  return `${XML_DECL}<w:fonts xmlns:w="${NS_W}">${fonts.join("")}</w:fonts>`;
}

/** One XML part (the body, the header or the footer) and the relationships it needs. */
interface Part {
  links: string[];
  images: { id: string; target: string }[];
  shared: Shared;
  /** Paragraph style for paragraphs that don't set their own (Header and Footer parts). */
  defaultStyle?: string;
  /** Formatting every run gets underneath its own, such as bold for a table's header row. */
  runDefaults?: Marks;
  /** Spacing every paragraph gets underneath its own, so paragraphs in table cells sit close together. */
  defaultFormat?: ParagraphFormat;
  /** Overrides the widest an image may be, in pixels, while writing a table cell. */
  maxImageWidth?: number;
}

function newPart(shared: Shared, defaultStyle?: string): Part {
  return { links: [], images: [], shared, defaultStyle };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decodes base64 without `atob`, which JavaScriptCore and QuickJS may not provide. */
function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = BASE64.indexOf(clean[i]!);
    const b = BASE64.indexOf(clean[i + 1]!);
    const c = i + 2 < clean.length ? BASE64.indexOf(clean[i + 2]!) : -1;
    const d = i + 3 < clean.length ? BASE64.indexOf(clean[i + 3]!) : -1;
    out[o++] = (a << 2) | (b >> 4);
    if (c >= 0) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

function decodeImage(src: string): { bytes: Uint8Array; ext: "png" | "jpeg" | "gif" } | null {
  const m = /^data:image\/(png|jpe?g|gif);base64,(.*)$/is.exec(src);
  if (!m) return null;
  const ext = m[1]!.toLowerCase().startsWith("jp") ? "jpeg" : (m[1]!.toLowerCase() as "png" | "gif");
  return { bytes: decodeBase64(m[2]!), ext };
}

const JC: Record<Align, string> = { left: "left", center: "center", right: "right", justify: "both" };

function runPropsXml(m: NonNullable<Run["marks"]> | undefined, styleIds?: Map<string, string>, fonts?: FontUse): string {
  if (!m) return "";
  let props = "";
  if (m.link) props += '<w:rStyle w:val="Hyperlink"/>';
  else if (m.style && styleIds?.has(m.style)) props += `<w:rStyle w:val="${styleIds.get(m.style)}"/>`;
  const family = m.fontFamily?.trim();
  const font = family ? esc(fontName(fonts, family)) : m.code ? esc(fontName(fonts, "Courier New")) : undefined;
  if (font) props += `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>`;
  if (m.bold) props += "<w:b/>";
  if (m.italic) props += "<w:i/>";
  if (m.strike) props += "<w:strike/>";
  const color = m.color && hex(m.color);
  if (color) props += `<w:color w:val="${color}"/>`;
  if (m.fontSize) props += `<w:sz w:val="${Math.round(m.fontSize * 2)}"/><w:szCs w:val="${Math.round(m.fontSize * 2)}"/>`;
  const shade = m.highlight && hex(m.highlight);
  const named = shade && HIGHLIGHT_NAMES[shade];
  if (named) props += `<w:highlight w:val="${named}"/>`;
  if (m.underline || m.link) props += '<w:u w:val="single"/>';
  if (shade && !named) props += `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>`;
  if (m.superscript) props += '<w:vertAlign w:val="superscript"/>';
  else if (m.subscript) props += '<w:vertAlign w:val="subscript"/>';
  return props;
}

function runXml(run: Run, part: Part): string {
  const m = part.runDefaults ? { ...part.runDefaults, ...run.marks } : run.marks;
  const props = runPropsXml(m, part.shared.styleIds, part.shared.fonts);
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : "";

  if (m?.footnote) {
    const style = '<w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>';
    // At the start of a note, Word wants the number again, as a reference to the note itself.
    if (m.footnote === FOOTNOTE_SELF) return `<w:r>${style}<w:footnoteRef/></w:r>`;
    const id = part.shared.footnoteIds.get(m.footnote);
    return id === undefined ? "" : `<w:r>${style}<w:footnoteReference w:id="${id}"/></w:r>`;
  }

  if (m?.field) {
    // The run's text is the cached value; Word recomputes it per page.
    const instr = m.field === "page" ? " PAGE " : " NUMPAGES ";
    return `<w:fldSimple w:instr="${instr}"><w:r>${rPr}<w:t>${esc(run.text)}</w:t></w:r></w:fldSimple>`;
  }

  // Tabs and newlines are elements in WordprocessingML, not characters.
  const deleted = m?.suggest?.kind === "delete";
  let body = "";
  for (const piece of run.text.split(/(\n|\t)/)) {
    if (piece === "\n") body += "<w:br/>";
    else if (piece === "\t") body += "<w:tab/>";
    else if (piece !== "") body += `<w:${deleted ? "delText" : "t"} xml:space="preserve">${esc(piece)}</w:${deleted ? "delText" : "t"}>`;
  }
  let r = `<w:r>${rPr}${body}</w:r>`;
  // A suggestion is a tracked change: Word shows who made it and when, and offers to accept or reject it.
  if (m?.suggest) {
    const { suggest } = m;
    const tag = suggest.kind === "insert" ? "ins" : "del";
    const author = part.shared.authorName(suggest.by) || suggest.by;
    r = `<w:${tag} w:id="${part.shared.revision++}" w:author="${esc(author)}" w:date="${new Date(suggest.at).toISOString().replace(/\.\d+Z$/, "Z")}">${r}</w:${tag}>`;
  }
  if (m?.link) {
    part.links.push(m.link);
    return `<w:hyperlink r:id="rIdLink${part.links.length}">${r}</w:hyperlink>`;
  }
  return r;
}

interface ParagraphOptions {
  /** Runs written before the text, such as the anchors of pictures that text wraps around. */
  prefix?: string;
  style?: string;
  num?: { id: number; level: number };
  align?: Align;
  border?: boolean;
  format?: ParagraphFormat;
}

function paragraphPropsXml(opts: ParagraphOptions): string {
  let props = "";
  if (opts.style) props += `<w:pStyle w:val="${opts.style}"/>`;
  if (opts.num) {
    props += `<w:numPr><w:ilvl w:val="${opts.num.level}"/><w:numId w:val="${opts.num.id}"/></w:numPr>`;
  }
  if (opts.border) {
    props += '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr>';
  }
  const f = opts.format;
  if (f && (f.spaceBefore !== undefined || f.spaceAfter !== undefined || f.lineHeight !== undefined)) {
    let spacing = "";
    if (f.spaceBefore !== undefined) spacing += ` w:before="${Math.round(f.spaceBefore * TWIPS_PER_PT)}"`;
    if (f.spaceAfter !== undefined) spacing += ` w:after="${Math.round(f.spaceAfter * TWIPS_PER_PT)}"`;
    if (f.lineHeight !== undefined) spacing += ` w:line="${Math.round(f.lineHeight * 240)}" w:lineRule="auto"`;
    props += `<w:spacing${spacing}/>`;
  }
  if (f && (f.indentLeft || f.indentRight || f.indentFirst)) {
    let ind = "";
    if (f.indentLeft) ind += ` w:left="${Math.round(f.indentLeft * TWIPS_PER_PT)}"`;
    if (f.indentRight) ind += ` w:right="${Math.round(f.indentRight * TWIPS_PER_PT)}"`;
    if (f.indentFirst && f.indentFirst > 0) ind += ` w:firstLine="${Math.round(f.indentFirst * TWIPS_PER_PT)}"`;
    if (f.indentFirst && f.indentFirst < 0) ind += ` w:hanging="${Math.round(-f.indentFirst * TWIPS_PER_PT)}"`;
    props += `<w:ind${ind}/>`;
  }
  if (opts.align && opts.align !== "left") props += `<w:jc w:val="${JC[opts.align]}"/>`;
  return props;
}

/** The runs of a paragraph, with the start and end of each comment's range in the places it begins and ends. */
function runsXml(runs: readonly Run[], part: Part): string {
  const comments = part.shared.comments;
  if (comments.size === 0) return runs.map((r) => runXml(r, part)).join("");
  let out = "";
  let open: string[] = [];
  const start = (id: string) => {
    const c = comments.get(id)!;
    c.seen++;
    // A thread across several paragraphs is one range, from its first text to its last.
    return c.seen === 1 ? c.word.map((n) => `<w:commentRangeStart w:id="${n}"/>`).join("") : "";
  };
  const end = (id: string) => {
    const c = comments.get(id)!;
    return c.seen === c.total
      ? c.word.map((n) => `<w:commentRangeEnd w:id="${n}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${n}"/></w:r>`).join("")
      : "";
  };
  for (const run of runs) {
    const ids = (run.marks?.comment ?? []).filter((id) => comments.has(id));
    for (const id of open) if (!ids.includes(id)) out += end(id);
    for (const id of ids) if (!open.includes(id)) out += start(id);
    open = ids;
    out += runXml(run, part);
  }
  for (const id of open) out += end(id);
  return out;
}

function paragraphXml(runs: readonly Run[], part: Part, opts: ParagraphOptions = {}): string {
  const format = part.defaultFormat || opts.format ? { ...part.defaultFormat, ...opts.format } : undefined;
  const props = paragraphPropsXml({ ...opts, format, style: opts.style ?? part.defaultStyle });
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${opts.prefix ?? ""}${runsXml(runs, part)}</w:p>`;
}

/** Whether a picture can have text wrapped around it here: in the body, not in a table cell, header, footer or note. */
/** Pictures can float in the body and in table cells. Headers, footers and notes (which have a default paragraph style) keep them on a line. */
const canFloat = (part: Part): boolean => part.defaultStyle === undefined;

/** The drawing that puts a picture in a run: on its line, or (with `wrap`) anchored to the left or right with text around it. Null when the picture can't be embedded. */
/** Word's crop of a picture: what is cut away from each side, in thousandths of a percent of the picture. */
function srcRect(block: ImageBlock): string {
  const c = block.crop;
  if (!c) return "";
  const t = (n: number) => Math.round(n * 100000);
  return `<a:srcRect l="${t(c.left)}" t="${t(c.top)}" r="${t(c.right)}" b="${t(c.bottom)}"/>`;
}

/** Where an object that floats sits, as Word writes it: what it is measured from and how far, or which side it is lined up with. */
function placementXml(float: FloatPlacement): string {
  const axis = (tag: "positionH" | "positionV", position: FloatPlacement["x"] | FloatPlacement["y"]) => {
    const side = position.align === "left" || position.align === "top" ? (tag === "positionH" ? "left" : "top") : position.align === "right" || position.align === "bottom" ? (tag === "positionH" ? "right" : "bottom") : position.align;
    const inner = side ? `<wp:align>${side}</wp:align>` : `<wp:posOffset>${Math.round((position.offset ?? 0) * EMU_PER_PX)}</wp:posOffset>`;
    return `<wp:${tag} relativeFrom="${position.from}">${inner}</wp:${tag}>`;
  };
  return `<wp:simplePos x="0" y="0"/>${axis("positionH", float.x)}${axis("positionV", float.y)}`;
}

/** The start of the `wp:anchor` of a floating object: it takes no room in the text, and the text goes straight through it. */
function anchorOpen(float: FloatPlacement, part: Part): string {
  const order = 251658240 + (float.z ?? 0) + part.shared.nextDocPr;
  return `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${Math.max(0, Math.round(order))}" behindDoc="${float.behind ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">`;
}

function drawingXml(block: ImageBlock, part: Part, wrap?: "left" | "right", float?: FloatPlacement): string | null {
  const image = decodeImage(block.src);
  if (!image) return null;
  const { shared } = part;
  const limit = float ? Infinity : (part.maxImageWidth ?? shared.maxImageWidthPx);
  const scale = block.width > limit ? limit / block.width : 1;
  const cx = Math.round(block.width * scale * EMU_PER_PX);
  const cy = Math.round(block.height * scale * EMU_PER_PX);

  const index = shared.nextImage++;
  const file = `image${index}.${image.ext === "jpeg" ? "jpg" : image.ext}`;
  shared.media.push({ name: file, bytes: image.bytes });
  const rid = `rIdImg${part.images.length + 1}`;
  part.images.push({ id: rid, target: `media/${file}` });
  const docPr = shared.nextDocPr++;

  const graphic =
    `<wp:docPr id="${docPr}" name="Picture ${docPr}" descr="${esc(block.alt ?? "")}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${NS_A}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${NS_A}"><a:graphicData uri="${NS_PIC}">` +
    `<pic:pic xmlns:pic="${NS_PIC}"><pic:nvPicPr><pic:cNvPr id="0" name="${file}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/>${srcRect(block)}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic>`;

  if (float) {
    return (
      `<w:drawing>${anchorOpen(float, part)}${placementXml(float)}` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>${graphic}</wp:anchor></w:drawing>`
    );
  }
  if (wrap) {
    // 14 px of space between the picture and the text, on the side the text is on.
    const gap = 14 * EMU_PER_PX;
    return (
      `<w:drawing><wp:anchor distT="0" distB="${Math.round(8 * EMU_PER_PX)}" distL="${wrap === "left" ? 0 : gap}" distR="${wrap === "left" ? gap : 0}" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
      `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${part.maxImageWidth !== undefined ? "column" : "margin"}"><wp:align>${wrap}</wp:align></wp:positionH>` +
      `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>` +
      `${graphic}</wp:anchor></w:drawing>`
    );
  }
  return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>${graphic}</wp:inline></w:drawing>`;
}

function imageXml(block: ImageBlock, part: Part): string {
  const drawing = drawingXml(block, part);
  if (!drawing) {
    // Remote images can't be embedded without fetching them, so leave a visible placeholder.
    const label = block.alt ? `[Image: ${block.alt}]` : `[Image: ${block.src.slice(0, 80)}]`;
    return paragraphXml([{ text: label, marks: { italic: true } }], part, { align: block.align });
  }
  const props = paragraphPropsXml({ align: block.align });
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}<w:r>${drawing}</w:r></w:p>`;
}

/**
 * A table of contents as a Word field. The entries shown are the headings now; Word refreshes
 * the field (and fills in page numbers) when the document is opened and the user accepts the
 * update prompt, or on right-click > Update Field.
 */
function tocXml(doc: Doc, block: TocBlock, part: Part): string {
  part.shared.hasToc = true;
  const headings = doc.blocks.filter((b): b is HeadingBlock => b.type === "heading" && b.level <= block.levels);
  const title = block.title ?? "Table of contents";
  const out: string[] = [];
  if (title) out.push(paragraphXml([{ text: title }], part, { style: "TOCHeading" }));

  const begin = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-${block.levels}" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
  const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const entries = headings.length > 0 ? headings : null;
  if (!entries) {
    out.push(`<w:p>${begin}<w:r><w:t>Right-click and choose Update Field to build the table of contents.</w:t></w:r>${end}</w:p>`);
  } else {
    entries.forEach((h, i) => {
      const text = `<w:r><w:t xml:space="preserve">${esc(plainText(h.runs))}</w:t></w:r>`;
      out.push(
        `<w:p><w:pPr><w:pStyle w:val="TOC${h.level}"/></w:pPr>${i === 0 ? begin : ""}${text}${i === entries.length - 1 ? end : ""}</w:p>`,
      );
    });
  }
  return out.join("");
}

/**
 * A Word table with a fixed column grid sized from the text width, a repeating header row, shading
 * and borders. Cells hold ordinary paragraphs, lists and images.
 */
/** The text box or shape of a table that floats, as a drawing: Word's `wps` shape, with the text inside it. */
function textBoxXml(table: TableBlock & { float: FloatPlacement & BoxStyle }, doc: Doc, part: Part): string {
  const { float } = table;
  const cell = table.rows[0]!.cells[0]!;
  const cx = Math.round(float.width * EMU_PER_PX);
  const cy = Math.round(float.height * EMU_PER_PX);
  const docPr = part.shared.nextDocPr++;
  const padding = float.padding ?? { x: 10, y: 5 };

  const colour = (value: string, opacity?: number) => `<a:srgbClr val="${hex(value) ?? "000000"}">${opacity !== undefined && opacity < 1 ? `<a:alpha val="${Math.round(opacity * 100000)}"/>` : ""}</a:srgbClr>`;
  const fill = float.fill ? `<a:solidFill>${colour(float.fill, float.fillOpacity)}</a:solidFill>` : "<a:noFill/>";
  const line = float.line
    ? `<a:ln w="${Math.round(float.line.width * EMU_PER_PX)}"${float.line.style === "double" ? ' cmpd="dbl"' : ""}><a:solidFill>${colour(float.line.color)}</a:solidFill>` +
      (float.line.style === "dashed" ? '<a:prstDash val="dash"/>' : float.line.style === "dotted" ? '<a:prstDash val="sysDot"/>' : "") +
      "</a:ln>"
    : "<a:ln><a:noFill/></a:ln>";
  const geometry = float.shape === "ellipse" ? "ellipse" : float.shape === "round_rect" ? "roundRect" : "rect";

  const saved = { runDefaults: part.runDefaults, defaultFormat: part.defaultFormat, maxImageWidth: part.maxImageWidth };
  part.runDefaults = undefined;
  part.defaultFormat = { spaceAfter: 2 };
  part.maxImageWidth = Math.max(16, float.width - padding.x * 2 - 4);
  const content = blocksXml(cell.blocks, doc, part);
  Object.assign(part, saved);

  const inset = (px: number) => Math.round(px * EMU_PER_PX);
  const anchorAt = cell.vAlign === "middle" ? "ctr" : cell.vAlign === "bottom" ? "b" : "t";
  return (
    `<w:drawing>${anchorOpen(float, part)}${placementXml(float)}` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${docPr}" name="Text Box ${docPr}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="${NS_A}"><a:graphicData uri="${NS_WPS}"><wps:wsp xmlns:wps="${NS_WPS}"><wps:cNvSpPr txBox="1"/>` +
    `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom>${fill}${line}</wps:spPr>` +
    `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>` +
    `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="${inset(padding.x)}" tIns="${inset(padding.y)}" rIns="${inset(padding.x)}" bIns="${inset(padding.y)}" anchor="${anchorAt}" anchorCtr="0"><a:noAutofit/></wps:bodyPr>` +
    `</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>`
  );
}

function tableXml(table: TableBlock, doc: Doc, part: Part): string {
  const total = part.shared.textWidthTwips;
  const widths = table.columns.map((f) => Math.round(f * total));
  // Fold rounding into the last column so the grid adds up to the full width.
  widths[widths.length - 1]! += total - widths.reduce((sum, w) => sum + w, 0);

  const borders = table.borders ?? "all";
  const line = '<w:{n} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>';
  const none = '<w:{n} w:val="nil"/>';
  const edge = (name: string, drawn: boolean) => (drawn ? line : none).replace("{n}", name).replace("{n}", name);
  const all = borders === "all";
  const horizontal = borders !== "none";
  const tblBorders =
    "<w:tblBorders>" +
    edge("top", horizontal) + edge("left", all) + edge("bottom", horizontal) + edge("right", all) +
    edge("insideH", horizontal) + edge("insideV", all) +
    "</w:tblBorders>";

  const origins = originMap(table);
  const sum = (from: number, count: number) => widths.slice(from, from + count).reduce((total, w) => total + w, 0);
  const VALIGN = { top: "top", middle: "center", bottom: "bottom" } as const;

  const rows = table.rows
    .map((row, r) => {
      const header = r === 0 && !!table.headerRow;
      const cells = row.cells
        .map((cell, c) => {
          if (cell.covered) {
            // Word stores a vertical merge as an empty continuation cell in each lower row. Squares
            // covered sideways, or beside the first column of a merge, are spanned by a cell to their left.
            const o = origins[r]![c]!;
            if (o.row === r || o.col !== c) return "";
            const origin = table.rows[o.row]!.cells[o.col]!;
            const cols = colSpanOf(origin);
            return (
              `<w:tc><w:tcPr><w:tcW w:w="${sum(c, cols)}" w:type="dxa"/>${cols > 1 ? `<w:gridSpan w:val="${cols}"/>` : ""}<w:vMerge/></w:tcPr><w:p/></w:tc>`
            );
          }
          const cols = colSpanOf(cell);
          const fill = hex(cell.shade ?? (header ? "#f3f4f6" : ""));
          const tcPr =
            `<w:tcPr><w:tcW w:w="${sum(c, cols)}" w:type="dxa"/>` +
            (cols > 1 ? `<w:gridSpan w:val="${cols}"/>` : "") +
            (rowSpanOf(cell) > 1 ? '<w:vMerge w:val="restart"/>' : "") +
            (fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : "") +
            (cell.vAlign ? `<w:vAlign w:val="${VALIGN[cell.vAlign]}"/>` : "") +
            "</w:tcPr>";

          const saved = { runDefaults: part.runDefaults, defaultFormat: part.defaultFormat, maxImageWidth: part.maxImageWidth };
          part.runDefaults = header ? { bold: true } : undefined;
          part.defaultFormat = { spaceAfter: 2 };
          part.maxImageWidth = Math.max(16, sum(c, cols) / 15 - 14);
          const content = blocksXml(cell.blocks, doc, part);
          Object.assign(part, saved);
          return `<w:tc>${tcPr}${content}</w:tc>`;
        })
        .join("");
      const height = row.height ? `<w:trHeight w:val="${Math.round(row.height * TWIPS_PER_PT)}" w:hRule="atLeast"/>` : "";
      return `<w:tr><w:trPr><w:cantSplit/>${height}${header ? "<w:tblHeader/>" : ""}</w:trPr>${cells}</w:tr>`;
    })
    .join("");

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/>${tblBorders}<w:tblLayout w:type="fixed"/>` +
    '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows}</w:tbl>`
  );
}

function blocksXml(blocks: readonly Block[], doc: Doc, part: Part): string {
  const body: string[] = [];
  let previousTable = false;
  const { shared } = part;
  const lists = listPlan(blocks, shared.numbering);
  const numbers = listNumbers(blocks);
  /** The numbered list instance the last numbered item was written in, and the numbers Word would have reached in it. */
  let instance: NumberingInstance | null = null;
  /** The numbers of the items so far at each depth, as the editor counts them. */
  const ours: number[] = [];

  /**
   * What a paragraph is written with. A paragraph (not a heading or other type) in a paragraph style is written in
   * that style, which Word can edit; anything else takes the look of its style as direct formatting, because it
   * already has the style of its own type.
   */
  const written = <B extends Exclude<Block, { type: "code_block" } | { type: "divider" } | { type: "page_break" } | { type: "section_break" } | { type: "image" } | { type: "toc" } | { type: "table" }>>(block: B) => {
    const known = block.style && doc.styles?.[block.style]?.kind === "paragraph" ? block.style : undefined;
    if (!known) return { runs: block.runs, align: block.align, format: block.format, style: undefined as string | undefined };
    if (block.type === "paragraph") return { runs: block.runs, align: block.align, format: block.format, style: shared.styleIds.get(known) };
    const shown = withParagraphStyle(doc, block);
    return { runs: block.runs.map((r) => ({ ...r, marks: effectiveMarks(doc, r.marks, known) })), align: shown.align, format: shown.format, style: undefined as string | undefined };
  };

  /** Pictures that text wraps around wait here and are anchored to the text paragraph after them. */
  let floats = "";
  const takeFloats = (): string => {
    const taken = floats;
    floats = "";
    return taken;
  };

  for (const [at, block] of blocks.entries()) {
    // Anything that isn't text after a wrapped picture gets a paragraph of its own to hold it.
    if (floats && !("runs" in block) && !(block.type === "image" && block.wrap && canFloat(part)) && !(isFloating(block) && canFloat(part))) body.push(`<w:p>${takeFloats()}</w:p>`);
    if (block.type !== "list_item") ours.length = 0;
    const afterTable: boolean = previousTable;
    previousTable = block.type === "table";

    switch (block.type) {
      case "paragraph": {
        const w = written(block);
        body.push(paragraphXml(w.runs, part, { prefix: takeFloats(), style: w.style, align: w.align, format: w.format }));
        break;
      }
      case "title": {
        const w = written(block);
        body.push(paragraphXml(w.runs, part, { prefix: takeFloats(), style: "Title", align: w.align, format: w.format }));
        break;
      }
      case "subtitle": {
        const w = written(block);
        body.push(paragraphXml(w.runs, part, { prefix: takeFloats(), style: "Subtitle", align: w.align, format: w.format }));
        break;
      }
      case "heading": {
        const w = written(block);
        body.push(paragraphXml(w.runs, part, { prefix: takeFloats(), style: `Heading${block.level}`, align: w.align, format: w.format }));
        break;
      }
      case "quote": {
        const w = written(block);
        body.push(paragraphXml(w.runs, part, { prefix: takeFloats(), style: "Quote", align: w.align, format: w.format }));
        break;
      }
      case "code_block": {
        const source = block.runs.map((r) => r.text).join("");
        body.push(paragraphXml([{ text: source }], part, { style: "CodeBlock" }));
        break;
      }
      case "divider":
        body.push(paragraphXml([], part, { border: true }));
        break;
      case "page_break":
        body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
        break;
      case "image": {
        if (block.float && canFloat(part)) {
          const placed = drawingXml(block, part, undefined, block.float);
          if (placed) floats += `<w:r>${placed}</w:r>`;
          break;
        }
        const drawing = block.wrap && canFloat(part) ? drawingXml(block, part, block.wrap) : null;
        if (drawing) floats += `<w:r>${drawing}</w:r>`;
        else body.push(imageXml(block, part));
        break;
      }
      case "toc":
        body.push(tocXml(doc, block, part));
        break;
      case "section_break":
        // Sections are written by `toDocx`, not as blocks.
        break;
      case "table":
        // A text box is anchored to the paragraph after it, like a picture that floats.
        if (isFloating(block) && canFloat(part)) {
          floats += `<w:r>${textBoxXml(block, doc, part)}</w:r>`;
          previousTable = afterTable;
          break;
        }
        // Word needs a paragraph between two tables, or it merges them into one.
        if (afterTable) body.push("<w:p/>");
        body.push(tableXml(block, doc, part));
        break;
      case "list_item": {
        const level = Math.min(Math.max(block.depth, 0), MAX_LEVEL);
        let id: number;
        ours.length = block.depth + 1;
        if (block.list === "bullet") {
          ours[block.depth] = 0;
          id = bulletNumId(shared.numbering, lists.get(at)!.bullet);
        } else {
          const n = numbers[at]!;
          ours[block.depth] = n;
          // Word counts on in a list through anything between, so a list that the editor restarts, or starts at another number, is a new one.
          if (!instance || instance.abstractId !== lists.get(at)!.ordered || nextNumber(instance, level) !== n) {
            const starts = Array.from({ length: MAX_LEVEL + 1 }, (_, i) => (i < level ? (ours[i] ?? 0) + 1 : i === level ? n : 1));
            instance = newInstance(shared.numbering, lists.get(at)!.ordered, starts);
          }
          instance.counters.length = level + 1;
          instance.counters[level] = n;
          id = instance.id;
        }
        const w = written(block);
        body.push(paragraphXml(w.runs, part, { prefix: takeFloats(), style: "ListParagraph", num: { id, level }, align: w.align, format: w.format }));
        break;
      }
    }
  }
  if (floats) body.push(`<w:p>${takeFloats()}</w:p>`);
  // A table can't be the last thing in the body, a cell or a header: Word wants a paragraph after it.
  if (previousTable) body.push("<w:p/>");
  return body.join("");
}

const ROOT_NS = `xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}"`;

/** A header or footer written as its own part of the Word file. */
interface RegionPart {
  /** The section this is for. A section without its own header or footer shows the previous section's. */
  section: number;
  kind: "header" | "footer";
  /** Which pages use it, in Word's terms. */
  type: "default" | "first" | "even";
  part: Part;
  xml: string;
  file: string;
  rid: string;
}

/**
 * The properties of one section: its columns and how it starts, with the headers and footers it has of its own.
 * A section without any shows the previous section's, which is how Word links them.
 */
function sectPrXml(page: PageSetup, regions: readonly RegionPart[], section: { columns: ColumnSetup; continuous: boolean; titlePg: boolean }): string {
  const { width, height } = pageDimensions(page);
  const twips = (inches: number) => Math.round(inches * 1440);
  const m = page.margins;
  const landscape = page.orientation === "landscape" ? ' w:orient="landscape"' : "";
  const { count, gap, rule } = section.columns;
  return (
    "<w:sectPr>" +
    regions.map((r) => `<w:${r.kind}Reference w:type="${r.type}" r:id="${r.rid}"/>`).join("") +
    (section.continuous ? '<w:type w:val="continuous"/>' : "") +
    `<w:pgSz w:w="${twips(width)}" w:h="${twips(height)}"${landscape}/>` +
    `<w:pgMar w:top="${twips(m.top)}" w:right="${twips(m.right)}" w:bottom="${twips(m.bottom)}" w:left="${twips(m.left)}" w:header="720" w:footer="720" w:gutter="0"/>` +
    (count > 1 ? `<w:cols w:num="${count}" w:space="${Math.round(gap * 20)}"${rule ? ' w:sep="1"' : ""}/>` : "") +
    (section.titlePg ? "<w:titlePg/>" : "") +
    "</w:sectPr>"
  );
}

function headingStyle(level: number): string {
  const sizes = [32, 26, 24, 22, 22, 22];
  return (
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/>` +
    '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    `<w:pPr><w:keepNext/><w:spacing w:before="${level === 1 ? 360 : 240}" w:after="80"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${sizes[level - 1]}"/></w:rPr></w:style>`
  );
}

function tocStyle(level: number): string {
  return (
    `<w:style w:type="paragraph" w:styleId="TOC${level}"><w:name w:val="toc ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/>` +
    `<w:pPr><w:spacing w:after="100"/><w:ind w:left="${(level - 1) * 220}"/></w:pPr></w:style>`
  );
}

/** The id a named style of the document has in the file. */
function wordStyleId(id: string): string {
  return `Pli_${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/** The document's own styles as `w:style` elements, each based on the one it is based on (or on Normal). */
function customStylesXml(doc: Doc, fonts: FontUse): string {
  return Object.entries(doc.styles ?? {})
    .map(([id, style]) => {
      const base = style.basedOn && doc.styles?.[style.basedOn]?.kind === style.kind ? wordStyleId(style.basedOn) : style.kind === "paragraph" ? "Normal" : undefined;
      const rPr = runPropsXml(style.marks, undefined, fonts);
      const pPr = style.kind === "paragraph" ? paragraphPropsXml({ align: style.align, format: style.format }) : "";
      return (
        `<w:style w:type="${style.kind}" w:customStyle="1" w:styleId="${wordStyleId(id)}"><w:name w:val="${esc(style.name)}"/>` +
        (base ? `<w:basedOn w:val="${base}"/>` : "") +
        "<w:qFormat/>" +
        (pPr ? `<w:pPr>${pPr}</w:pPr>` : "") +
        (rPr ? `<w:rPr>${rPr}</w:rPr>` : "") +
        "</w:style>"
      );
    })
    .join("");
}

function stylesXml(doc: Doc, fonts: FontUse): string {
  return (
    XML_DECL +
    `<w:styles xmlns:w="${NS_W}">` +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="666666"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>' +
    [1, 2, 3, 4, 5, 6].map(headingStyle).join("") +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:after="160" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="20"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="18"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="18"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>' +
    [1, 2, 3, 4, 5, 6].map(tocStyle).join("") +
    '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
    customStylesXml(doc, fonts) +
    "</w:styles>"
  );
}

const BULLET_TEXT: Record<string, string> = { disc: "•", circle: "o", square: "▪" };
const NUMBER_FORMAT: Record<string, string> = {
  decimal: "decimal",
  "lower-alpha": "lowerLetter",
  "upper-alpha": "upperLetter",
  "lower-roman": "lowerRoman",
  "upper-roman": "upperRoman",
};

/** What one numbering definition says: the marker of each of the nine levels. */
interface NumberingAbstract {
  id: number;
  bullet: boolean;
  markers: ListMarker[];
}

/** One use of a definition. The numbers at each level start where `starts` says. */
interface NumberingInstance {
  id: number;
  abstractId: number;
  starts: number[];
  /** The last number given at each level, which is what Word carries on from. */
  counters: number[];
}

interface NumberingState {
  abstracts: NumberingAbstract[];
  instances: NumberingInstance[];
  /** The `w:num` of each bullet definition, which never needs to restart. */
  bulletNums: Map<number, number>;
  nextNum: number;
}

const levelMarkers = (list: "bullet" | "ordered", pick: (depth: number) => ListMarker | undefined): ListMarker[] =>
  Array.from({ length: MAX_LEVEL + 1 }, (_, d) => pick(d) ?? defaultMarker(list, d));

function newNumbering(): NumberingState {
  return {
    // 0 and 1 are the defaults, written first. Ids 1 and 2 belong to them as numbers, so others begin at 3.
    abstracts: [
      { id: 0, bullet: true, markers: levelMarkers("bullet", () => undefined) },
      { id: 1, bullet: false, markers: levelMarkers("ordered", () => undefined) },
    ],
    instances: [],
    bulletNums: new Map([[0, 1]]),
    nextNum: 3,
  };
}

function abstractFor(state: NumberingState, bullet: boolean, markers: ListMarker[]): number {
  const found = state.abstracts.find((a) => a.bullet === bullet && a.markers.join() === markers.join());
  if (found) return found.id;
  const id = state.abstracts.length;
  state.abstracts.push({ id, bullet, markers });
  return id;
}

function bulletNumId(state: NumberingState, abstractId: number): number {
  let id = state.bulletNums.get(abstractId);
  if (id === undefined) {
    id = state.nextNum++;
    state.bulletNums.set(abstractId, id);
  }
  return id;
}

function newInstance(state: NumberingState, abstractId: number, starts: number[]): NumberingInstance {
  const instance: NumberingInstance = { id: state.nextNum++, abstractId, starts, counters: [] };
  state.instances.push(instance);
  return instance;
}

/** The number Word gives the next item at a level of an instance. */
function nextNumber(instance: NumberingInstance, level: number): number {
  const last = instance.counters[level];
  return last === undefined ? instance.starts[level] ?? 1 : last + 1;
}

/**
 * For each list item, the numbering definitions its stretch of list items uses. The marker of a level is the one the
 * first item at that depth names, so a list written with letters is lettered at every item of that depth.
 */
function listPlan(blocks: readonly Block[], state: NumberingState): Map<number, { bullet: number; ordered: number }> {
  const plan = new Map<number, { bullet: number; ordered: number }>();
  for (let from = 0; from < blocks.length; ) {
    if (blocks[from]!.type !== "list_item") {
      from++;
      continue;
    }
    let to = from;
    while (to < blocks.length && blocks[to]!.type === "list_item") to++;
    const items = blocks.slice(from, to) as ListItemBlock[];
    const abstractOf = (list: "bullet" | "ordered") => {
      const of = items.filter((i) => i.list === list);
      if (of.length === 0) return 0;
      const markers = levelMarkers(list, (d) => of.find((i) => i.depth === d && i.marker && markerOf(i) === i.marker)?.marker);
      return abstractFor(state, list === "bullet", markers);
    };
    const entry = { bullet: abstractOf("bullet"), ordered: abstractOf("ordered") };
    for (let i = from; i < to; i++) plan.set(i, entry);
    from = to;
  }
  return plan;
}

function numberingXml(state: NumberingState): string {
  const levels = (abstract: NumberingAbstract) =>
    abstract.markers
      .map((marker, i) => {
        const indent = 720 * (i + 1);
        const format = abstract.bullet ? "bullet" : NUMBER_FORMAT[marker]!;
        const text = abstract.bullet ? BULLET_TEXT[marker]! : `%${i + 1}.`;
        return (
          `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>` +
          `<w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr>` +
          (abstract.bullet && marker === "circle" ? '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New" w:hint="default"/></w:rPr>' : "") +
          "</w:lvl>"
        );
      })
      .join("");
  const overrides = (starts: number[]) => starts.map((n, i) => `<w:lvlOverride w:ilvl="${i}"><w:startOverride w:val="${n}"/></w:lvlOverride>`).join("");

  return (
    XML_DECL +
    `<w:numbering xmlns:w="${NS_W}">` +
    state.abstracts.map((a) => `<w:abstractNum w:abstractNumId="${a.id}"><w:multiLevelType w:val="hybridMultilevel"/>${levels(a)}</w:abstractNum>`).join("") +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
    [...state.bulletNums].filter(([abstractId]) => abstractId !== 0).map(([abstractId, id]) => `<w:num w:numId="${id}"><w:abstractNumId w:val="${abstractId}"/></w:num>`).join("") +
    state.instances.map((i) => `<w:num w:numId="${i.id}"><w:abstractNumId w:val="${i.abstractId}"/>${overrides(i.starts)}</w:num>`).join("") +
    "</w:numbering>"
  );
}

function relationshipsXml(rels: { id: string; type: string; target: string; external?: boolean }[]): string {
  return (
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rels
      .map(
        (r) =>
          `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`,
      )
      .join("") +
    "</Relationships>"
  );
}

const NS_W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const NS_W15 = "http://schemas.microsoft.com/office/word/2012/wordml";

/** `comments.xml`, and `commentsExtended.xml`, which is what makes replies show as replies and resolved threads as resolved. */
function commentsXml(threads: readonly Thread<DocAnchor>[], shared: Shared, authorName: (id: string) => string): [string, string] {
  let paraId = 0x10000000;
  let body = "";
  let extended = "";
  for (const thread of threads) {
    const ids = shared.comments.get(thread.id)!.word;
    let parent: string | null = null;
    thread.comments.forEach((comment, i) => {
      const id = (++paraId).toString(16).toUpperCase().padStart(8, "0");
      const name = authorName(comment.author) || comment.author;
      const initials = name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase();
      const date = new Date(comment.createdAt).toISOString().replace(/\.\d+Z$/, "Z");
      const paragraphs = comment.body.split(/\r?\n/).map((line, n) => {
        const mark = n === 0 ? '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>' : "";
        const attr = n === 0 ? ` w14:paraId="${id}"` : "";
        return `<w:p${attr}><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${mark}<w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`;
      });
      body += `<w:comment w:id="${ids[i]}" w:author="${esc(name)}" w:date="${date}" w:initials="${esc(initials)}">${paragraphs.join("")}</w:comment>`;
      extended += `<w15:commentEx w15:paraId="${id}"${parent ? ` w15:paraIdParent="${parent}"` : ""} w15:done="${thread.resolved ? 1 : 0}"/>`;
      parent ??= id;
    });
  }
  return [
    `${XML_DECL}<w:comments xmlns:w="${NS_W}" xmlns:w14="${NS_W14}">${body}</w:comments>`,
    `${XML_DECL}<w15:commentsEx xmlns:w15="${NS_W15}">${extended}</w15:commentsEx>`,
  ];
}

function partRels(part: Part) {
  return [
    ...part.links.map((href, i) => ({ id: `rIdLink${i + 1}`, type: `${REL}/hyperlink`, target: href, external: true })),
    ...part.images.map((image) => ({ id: image.id, type: `${REL}/image`, target: image.target })),
  ];
}

export interface DocxOptions {
  /**
   * Comment threads to write as Word comments. Defaults to the ones saved in the document (`doc.comments`); pass
   * `session.comments.threads` when they are kept in a store of your own. A thread whose text is gone is left out.
   */
  comments?: readonly Thread<DocAnchor>[];
  /** The name Word shows for a comment's author. Defaults to the user's id. */
  authorName?: (userId: string) => string;
  /**
   * What to do with fonts that Word doesn't come with. `"keep"` (the default) writes the family names as they are, with
   * a stand-in and a family kind in `fontTable.xml` for a computer that doesn't have the font; `"office"` writes the
   * nearest Office font in their place, for files that must look the same anywhere. Fonts are not embedded either way.
   */
  fonts?: "keep" | "office";
}

/**
 * Exports to a .docx file (Office Open XML). Returns the zipped bytes; write them
 * to disk, upload them, or wrap them in a Blob.
 *
 * Page size, margins, headers and footers (with page-number fields), images stored as data
 * URIs, fonts, sizes, spacing and a table of contents are all carried over.
 */
export function toDocx(doc: Doc, options: DocxOptions = {}): Uint8Array {
  const page = pageSetupOf(doc);
  const { width } = pageDimensions(page);
  const shared: Shared = {
    nextImage: 1,
    nextDocPr: 1,
    numbering: newNumbering(),
    media: [],
    hasToc: false,
    maxImageWidthPx: Math.max(1, (width - page.margins.left - page.margins.right) * PX_PER_INCH),
    textWidthTwips: Math.max(720, Math.round((width - page.margins.left - page.margins.right) * 1440)),
    footnoteIds: new Map(),
    comments: new Map(),
    styleIds: new Map(Object.keys(doc.styles ?? {}).map((id) => [id, wordStyleId(id)])),
    revision: 1000,
    authorName: options.authorName ?? ((id) => id),
    // The fonts the package always names: the document default and the code block's.
    fonts: { mode: options.fonts === "office" ? "office" : "keep", names: new Set(["Arial", "Courier New"]) },
  };
  // Comments are numbered in the order they are written, a thread's comments one after another.
  const threads = [...(options.comments ?? Object.values(doc.comments ?? {}))]
    .map((thread) => ({ thread, total: commentRanges(doc, thread.id).length }))
    .filter((t) => t.total > 0 && t.thread.comments.length > 0);
  let wordId = 0;
  for (const { thread, total } of threads) {
    shared.comments.set(thread.id, { word: thread.comments.map(() => wordId++), total, seen: 0 });
  }
  // Only notes that something refers to, and that have text, go into the file.
  const noted = footnoteIds(doc.blocks).filter((id) => doc.footnotes?.[id]?.length);
  noted.forEach((id, i) => shared.footnoteIds.set(id, i + 1));

  const bodyPart = newPart(shared);
  const sections = sectionsOf(doc);

  // One part per header or footer in use. A first-page or even-page one that is turned off is left out, though
  // the document keeps its content. One with nothing in it is left out too, which Word shows as blank.
  const regionParts: RegionPart[] = [];
  sections.forEach((section, index) => {
    const options = { differentFirstPage: hasFirstPageRegions(doc, sections, index), differentOddEven: page.differentOddEven };
    for (const kind of ["header", "footer"] as const) {
      for (const name of activeRegionNames(options, kind)) {
        const own = index === 0 ? doc[name] : section.start?.regions?.[name];
        // The first section has nothing to inherit, so empty means no part. A later section that is empty on purpose needs one.
        if (own === undefined || (own.length === 0 && index === 0)) continue;
        const part = newPart(shared, kind === "header" ? "Header" : "Footer");
        const n = regionParts.filter((r) => r.kind === kind).length + 1;
        regionParts.push({
          section: index,
          kind,
          type: regionVariant(name),
          part,
          xml: own.length === 0 ? "<w:p/>" : blocksXml(own, doc, part),
          file: `${kind}${n}.xml`,
          rid: `rId${kind === "header" ? "Header" : "Footer"}${n}`,
        });
      }
    }
  });
  // The body, a section at a time. Each section but the last ends with a paragraph that carries its properties;
  // the last section's properties close the body. A section takes its start type from the break before it.
  const bodyParts: string[] = [];
  let finalSectPr = "";
  sections.forEach((section, i) => {
    // Tables and images are sized to the width of this section's pages.
    const shape = sectionShape(doc, sections, i);
    const widthIn = pageDimensions(shape as PageSetup).width - shape.margins.left - shape.margins.right;
    shared.maxImageWidthPx = Math.max(1, widthIn * PX_PER_INCH);
    shared.textWidthTwips = Math.max(720, Math.round(widthIn * 1440));
    const xml = blocksXml(doc.blocks.slice(section.from, section.to), doc, bodyPart);
    const props = sectPrXml(shape as PageSetup, regionParts.filter((r) => r.section === i), {
      columns: section.columns,
      continuous: i > 0 && !startsOnNewPage(doc, sections, i),
      titlePg: hasFirstPageRegions(doc, sections, i),
    });
    if (i === sections.length - 1) {
      bodyParts.push(xml);
      finalSectPr = props;
    } else {
      bodyParts.push(xml, `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>${props}</w:pPr></w:p>`);
    }
  });
  const bodyXml = bodyParts.join("");

  // The notes are written after the body, which has now numbered its references.
  const notePart = newPart(shared, "FootnoteText");
  const noteXml = noted.map((id, i) => {
    const blocks = [...doc.footnotes![id]!];
    const first = blocks[0]!;
    if ("runs" in first) {
      blocks[0] = { ...first, runs: [{ text: "", marks: { footnote: FOOTNOTE_SELF } }, { text: " " }, ...first.runs] };
    }
    return `<w:footnote w:id="${i + 1}">${blocksXml(blocks, doc, notePart)}</w:footnote>`;
  });
  const hasNotes = noted.length > 0;
  const hasComments = threads.length > 0;
  // Always written: it tells Word to open the file as a current document, not in Compatibility Mode.
  const needsSettings = true;

  const documentXml =
    XML_DECL +
    `<w:document ${ROOT_NS}><w:body>${bodyXml || "<w:p/>"}${finalSectPr}</w:body></w:document>`;

  const docRels = [
    { id: "rIdStyles", type: `${REL}/styles`, target: "styles.xml" },
    { id: "rIdFontTable", type: `${REL}/fontTable`, target: "fontTable.xml" },
    { id: "rIdNumbering", type: `${REL}/numbering`, target: "numbering.xml" },
    ...(needsSettings ? [{ id: "rIdSettings", type: `${REL}/settings`, target: "settings.xml" }] : []),
    ...regionParts.map((r) => ({ id: r.rid, type: `${REL}/${r.kind}`, target: r.file })),
    ...(hasNotes ? [{ id: "rIdFootnotes", type: `${REL}/footnotes`, target: "footnotes.xml" }] : []),
    ...(hasComments
      ? [
          { id: "rIdComments", type: `${REL}/comments`, target: "comments.xml" },
          { id: "rIdCommentsExt", type: "http://schemas.microsoft.com/office/2011/relationships/commentsExtended", target: "commentsExtended.xml" },
        ]
      : []),
    ...partRels(bodyPart),
  ];

  const contentTypes =
    XML_DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Default Extension="gif" ContentType="image/gif"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>' +
    (needsSettings
      ? '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
      : "") +
    (hasNotes
      ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
      : "") +
    (hasComments
      ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
        '<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/>'
      : "") +
    regionParts
      .map((r) => `<Override PartName="/word/${r.file}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${r.kind}+xml"/>`)
      .join("") +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    "</Types>";

  const rootRels = relationshipsXml([
    { id: "rId1", type: `${REL}/officeDocument`, target: "word/document.xml" },
    { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" },
  ]);

  const core =
    XML_DECL +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:title>${esc(doc.title)}</dc:title>` +
    "</cp:coreProperties>";

  // The styles name fonts too, so they are written before the font table.
  const styles = stylesXml(doc, shared.fonts);
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "docProps/core.xml": strToU8(core),
    "word/document.xml": strToU8(documentXml),
    "word/styles.xml": strToU8(styles),
    "word/numbering.xml": strToU8(numberingXml(shared.numbering)),
    "word/_rels/document.xml.rels": strToU8(relationshipsXml(docRels)),
  };
  if (needsSettings) {
    files["word/settings.xml"] = strToU8(
      `${XML_DECL}<w:settings xmlns:w="${NS_W}">${page.differentOddEven ? "<w:evenAndOddHeaders/>" : ""}${shared.hasToc ? '<w:updateFields w:val="true"/>' : ""}${hasNotes ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' : ""}<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`,
    );
  }
  if (hasNotes) {
    files["word/footnotes.xml"] = strToU8(
      `${XML_DECL}<w:footnotes ${ROOT_NS}>` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        noteXml.join("") +
        "</w:footnotes>",
    );
    if (partRels(notePart).length > 0) files["word/_rels/footnotes.xml.rels"] = strToU8(relationshipsXml(partRels(notePart)));
  }
  if (hasComments) {
    const [comments, extended] = commentsXml(threads.map((t) => t.thread), shared, options.authorName ?? ((id) => id));
    files["word/comments.xml"] = strToU8(comments);
    files["word/commentsExtended.xml"] = strToU8(extended);
  }
  for (const r of regionParts) {
    const tag = r.kind === "header" ? "hdr" : "ftr";
    files[`word/${r.file}`] = strToU8(`${XML_DECL}<w:${tag} ${ROOT_NS}>${r.xml}</w:${tag}>`);
    if (partRels(r.part).length > 0) files[`word/_rels/${r.file}.rels`] = strToU8(relationshipsXml(partRels(r.part)));
  }
  for (const media of shared.media) files[`word/media/${media.name}`] = media.bytes;
  // Last, once every part has said which fonts it uses (comments and numbering write theirs as they are made above).
  files["word/fontTable.xml"] = strToU8(fontTableXml(shared.fonts.names));

  return zipSync(files);
}
