import { fontStack } from "@pli.dev/core";
import { sameShape, sectionShape, sectionsOf, type Section } from "../sections";
import { footnoteIds, numberFootnotes } from "../footnotes";
import { isFloating, type FloatingBlock } from "../model";
import type { Align, Block, Doc, HeadingBlock, ImageBlock, ListItemBlock, ListMarker, PageSetup, ParagraphFormat, Run, TableBlock, TocBlock } from "../model";
import { pageDimensions, pageSetupOf } from "../page";
import { defaultMarker, listLabels, markerOf } from "../lists";
import { plainText } from "../runs";
import { effectiveMarks, styleOfBlock, withParagraphStyle } from "../styles";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Only allow link schemes that cannot execute script. */
function safeHref(href: string): string {
  return /^\s*(https?:|mailto:|tel:|#|\/)/i.test(href) ? href : "#";
}

/** Only allow image sources that cannot execute script. */
function safeSrc(src: string): string {
  return /^\s*(https?:|data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp);|\/|\.)/i.test(src) ? src : "";
}

/** CSS values come from document data, so keep only characters a color or font name needs. */
function cssValue(value: string): string {
  return value.replace(/[^\w\s#%.,()'"-]/g, "");
}

/** `named` is the document and the block's paragraph style, when the text can take a look from a style. */
function renderRun(run: Run, named?: { doc: Doc; paragraph?: string }): string {
  let out = escapeHtml(run.text).replace(/\n/g, "<br>");
  const m = named ? effectiveMarks(named.doc, run.marks, named.paragraph) : run.marks;
  if (!m) return out;
  // The text of a footnote reference is its number (see `numberFootnotes`).
  if (m.footnote) return `<sup class="footnote-ref"><a href="#fn-${escapeHtml(run.text)}" id="fnref-${escapeHtml(run.text)}">${out}</a></sup>`;
  if (m.code) out = `<code>${out}</code>`;
  if (m.bold) out = `<strong>${out}</strong>`;
  if (m.italic) out = `<em>${out}</em>`;
  if (m.underline) out = `<u>${out}</u>`;
  if (m.strike) out = `<s>${out}</s>`;
  if (m.superscript) out = `<sup>${out}</sup>`;
  if (m.subscript) out = `<sub>${out}</sub>`;
  const style: string[] = [];
  if (m.color) style.push(`color:${cssValue(m.color)}`);
  if (m.highlight) style.push(`background-color:${cssValue(m.highlight)}`);
  if (m.fontFamily) {
    // The family and what stands in for it, ending in a generic one, so the text falls back sensibly where the font isn't there.
    const name = cssValue(m.fontFamily).replace(/['"]/g, "").trim();
    if (name) style.push(`font-family:${fontStack(name).replace(/"/g, "'")}`);
  }
  if (m.fontSize) style.push(`font-size:${Number(m.fontSize)}pt`);
  if (style.length > 0) out = `<span style="${escapeHtml(style.join(";"))}">${out}</span>`;
  if (m.link) out = `<a href="${escapeHtml(safeHref(m.link))}">${out}</a>`;
  if (m.suggest) {
    const tag = m.suggest.kind === "insert" ? "ins" : "del";
    out = `<${tag} data-suggestion="${escapeHtml(m.suggest.id)}" data-by="${escapeHtml(m.suggest.by)}" datetime="${new Date(m.suggest.at).toISOString()}">${out}</${tag}>`;
  }
  return out;
}

const inline = (runs: readonly Run[], doc?: Doc, block?: Block) => {
  const named = doc?.styles ? { doc, paragraph: block ? styleOfBlock(block) : undefined } : undefined;
  return runs.map((run) => renderRun(run, named)).join("");
};

/** The attribute that names a block's paragraph style, for CSS written against the output. */
const styleName = (doc: Doc, block: Block): string => {
  const id = styleOfBlock(block);
  return id && doc.styles?.[id] ? ` data-style="${escapeHtml(id)}"` : "";
};

function styleAttr(align: Align | undefined, format: ParagraphFormat | undefined, extra: string[] = []): string {
  const css = [...extra];
  if (align && align !== "left") css.push(`text-align:${align}`);
  if (format) {
    if (format.lineHeight) css.push(`line-height:${format.lineHeight}`);
    if (format.spaceBefore !== undefined) css.push(`margin-top:${format.spaceBefore}pt`);
    if (format.spaceAfter !== undefined) css.push(`margin-bottom:${format.spaceAfter}pt`);
    if (format.indentLeft) css.push(`margin-left:${format.indentLeft}pt`);
    if (format.indentRight) css.push(`margin-right:${format.indentRight}pt`);
    if (format.indentFirst) css.push(`text-indent:${format.indentFirst}pt`);
  }
  return css.length > 0 ? ` style="${css.join(";")}"` : "";
}

export interface HtmlOptions {
  /**
   * Wrap the output in a full HTML document with `<title>`, the document's page size for
   * printing, and basic styles. Default: false (fragment only).
   */
  fullDocument?: boolean;
}

export function headingAnchor(block: { id: string }): string {
  return `h-${block.id}`;
}

function tocHtml(doc: Doc, toc: TocBlock): string {
  const entries = doc.blocks.filter((b): b is HeadingBlock => b.type === "heading" && b.level <= toc.levels);
  const items = entries
    .map(
      (h) =>
        `<li style="margin-left:${(h.level - 1) * 1.5}em"><a href="#${headingAnchor(h)}">${escapeHtml(plainText(h.runs))}</a></li>`,
    )
    .join("\n");
  const title = toc.title ?? "Table of contents";
  return `<nav class="toc">${title ? `<p class="toc-title"><strong>${escapeHtml(title)}</strong></p>` : ""}<ul style="list-style:none;padding:0">\n${items}\n</ul></nav>`;
}

function blockHtml(doc: Doc, block: Exclude<Block, { type: "list_item" }>): string {
  const shown = withParagraphStyle(doc, block) as { align?: Align; format?: ParagraphFormat };
  const named = styleName(doc, block);
  switch (block.type) {
    case "paragraph":
      return `<p${named}${styleAttr(shown.align, shown.format)}>${inline(block.runs, doc, block)}</p>`;
    case "title":
      return `<p class="title"${named}${styleAttr(shown.align, shown.format, ["font-size:26pt", "font-weight:bold"])}>${inline(block.runs, doc, block)}</p>`;
    case "subtitle":
      return `<p class="subtitle"${named}${styleAttr(shown.align, shown.format, ["font-size:15pt", "color:#666"])}>${inline(block.runs, doc, block)}</p>`;
    case "heading":
      return `<h${block.level} id="${headingAnchor(block)}"${named}${styleAttr(shown.align, shown.format)}>${inline(block.runs, doc, block)}</h${block.level}>`;
    case "quote":
      return `<blockquote${named}${styleAttr(shown.align, shown.format)}><p>${inline(block.runs, doc, block)}</p></blockquote>`;
    case "code_block": {
      const lang = block.language ? ` class="language-${escapeHtml(block.language)}"` : "";
      return `<pre><code${lang}>${escapeHtml(plainText(block.runs))}</code></pre>`;
    }
    case "divider":
      return "<hr>";
    case "page_break":
      return '<div class="page-break" style="break-after:page"></div>';
    case "section_break":
      // A section is drawn by its wrapper; see `sectionsHtml`.
      return "";
    case "image": {
      const src = safeSrc(block.src);
      if (!src) return "";
      if (block.float) return floatHtml(doc, block as FloatingBlock);
      // A picture that text wraps around is a float, so what follows runs beside it.
      const float = block.wrap ? `float:${block.wrap};margin:${block.wrap === "left" ? "0 14px 8px 0" : "0 0 8px 14px"}` : "";
      const img = imageHtml(block, escapeHtml(src), float);
      return block.wrap ? img : `<p${styleAttr(block.align, undefined)}>${img}</p>`;
    }
    case "toc":
      return tocHtml(doc, block);
    case "table":
      return isFloating(block) ? floatHtml(doc, block) : tableHtml(doc, block);
  }
}

/**
 * A picture or text box that floats. Web pages have no pages to place it on, so it is placed against the text column at the
 * paragraph it belongs to: a zero-height box at that place, with the object positioned inside it. Distances are kept; lining up
 * with the left, middle or right of the column is kept too.
 */
function floatHtml(doc: Doc, block: FloatingBlock): string {
  const { x, y, behind, z } = block.float;
  const size = block.type === "image" ? { width: block.width, height: block.height } : { width: block.float.width, height: block.float.height };
  const across = x.align === "right" ? `right:${x.offset ?? 0}px` : x.align === "center" ? "left:50%;transform:translateX(-50%)" : `left:${x.offset ?? 0}px`;
  const place = `position:absolute;${across};top:${y.offset ?? 0}px;width:${Math.round(size.width)}px;height:${Math.round(size.height)}px;z-index:${behind ? -1 : 1 + Math.round(z ?? 0)}`;
  let inner: string;
  if (block.type === "image") {
    const src = safeSrc(block.src);
    if (!src) return "";
    inner = `<span style="${place}">${imageHtml(block, escapeHtml(src), "")}</span>`;
  } else {
    const f = block.float;
    const cell = block.rows[0]!.cells[0]!;
    const padding = f.padding ?? { x: 10, y: 5 };
    const radius = f.shape === "ellipse" ? "border-radius:50%" : f.shape === "round_rect" ? `border-radius:${Math.round(Math.min(f.width, f.height) / 6)}px` : "";
    const fill = f.fill ? `background-color:${cssValue(f.fill)}${f.fillOpacity !== undefined && f.fillOpacity < 1 ? ";background-color:" + rgbaOf(f.fill, f.fillOpacity) : ""}` : "";
    const line = f.line && f.line.width > 0 ? `border:${f.line.width}px ${f.line.style ?? "solid"} ${cssValue(f.line.color)}` : "";
    const where = cell.vAlign === "middle" ? "center" : cell.vAlign === "bottom" ? "flex-end" : "flex-start";
    const css = [place, "box-sizing:border-box", "overflow:hidden", `padding:${padding.y}px ${padding.x}px`, "display:flex", "flex-direction:column", `justify-content:${where}`, fill, line, radius].filter(Boolean).join(";");
    inner = `<div style="${css}">${blocksHtml(doc, cell.blocks)}</div>`;
  }
  return `<div class="float" style="position:relative;height:0">${inner}</div>`;
}

/** `#rrggbb` as an `rgba()` colour. */
function rgbaOf(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, opacity)})`;
}

/**
 * A picture as an image tag. A cropped one is drawn bigger than its box, and shifted, inside a box that hides the rest.
 * `float` is extra style for the outer tag.
 */
function imageHtml(block: ImageBlock, src: string, float: string): string {
  const w = Math.round(block.width), h = Math.round(block.height);
  const alt = escapeHtml(block.alt ?? "");
  const crop = block.crop;
  if (!crop) return `<img src="${src}" alt="${alt}" width="${w}" height="${h}"${float ? ` style="${float}"` : ""}>`;
  const fullW = block.width / (1 - crop.left - crop.right), fullH = block.height / (1 - crop.top - crop.bottom);
  const px = (n: number) => `${Math.round(n * 100) / 100}px`;
  return (
    `<span style="display:inline-block;overflow:hidden;position:relative;width:${px(block.width)};height:${px(block.height)}${float ? `;${float}` : ""}">` +
    `<img src="${src}" alt="${alt}" style="position:absolute;max-width:none;width:${px(fullW)};height:${px(fullH)};left:${px(-crop.left * fullW)};top:${px(-crop.top * fullH)}">` +
    `</span>`
  );
}

const BORDER = "1px solid #bfbfbf";

/** A table with its column widths, header row and cell shading. Cells hold ordinary blocks. */
function tableHtml(doc: Doc, table: TableBlock): string {
  const borders = table.borders ?? "all";
  const cellBorder =
    borders === "all" ? `border:${BORDER}` : borders === "horizontal" ? `border-top:${BORDER};border-bottom:${BORDER}` : "border:none";
  const cols = table.columns.map((w) => `<col style="width:${(w * 100).toFixed(4).replace(/\.?0+$/, "")}%">`).join("");
  const rows = table.rows
    .map((row, r) => {
      const header = r === 0 && table.headerRow;
      const tag = header ? "th" : "td";
      const cells = row.cells
        // A square under a merged cell has no cell of its own: the merged one spans it.
        .filter((cell) => !cell.covered)
        .map((cell) => {
          const shade = cell.shade ?? (header ? "#f3f4f6" : undefined);
          const style = [
            cellBorder,
            "padding:4pt 6pt",
            `vertical-align:${cell.vAlign ?? "top"}`,
            header ? "text-align:left" : "",
            shade ? `background-color:${cssValue(shade)}` : "",
          ]
            .filter(Boolean)
            .join(";");
          const span = (cell.colSpan ? ` colspan="${cell.colSpan}"` : "") + (cell.rowSpan ? ` rowspan="${cell.rowSpan}"` : "");
          return `<${tag}${span} style="${style}">${blocksHtml(doc, cell.blocks)}</${tag}>`;
        })
        .join("");
      return `<tr${row.height ? ` style="height:${row.height}pt"` : ""}>${cells}</tr>`;
    })
    .join("\n");
  return `<table style="border-collapse:collapse;width:100%;table-layout:fixed"><colgroup>${cols}</colgroup>\n${rows}\n</table>`;
}

/** CSS string for a header or footer line: text is literal, page-number fields become counters. */
function marginBoxContent(blocks: readonly Block[] | undefined): { align: Align; content: string } | null {
  const first = blocks?.find((b) => b.type === "paragraph" || b.type === "heading" || b.type === "title" || b.type === "subtitle");
  if (!first || !("runs" in first) || first.runs.length === 0) return null;
  const parts = first.runs.map((run) => {
    if (run.marks?.field) return run.marks.field === "page" ? "counter(page)" : "counter(pages)";
    return `"${run.text.replace(/["\\]/g, "\\$&").replace(/\n/g, " ")}"`;
  });
  const align = "align" in first && first.align ? first.align : "left";
  return { align: align === "justify" ? "left" : align, content: parts.join(" ") };
}

const BOX_STYLE = "font: 9pt Arial, sans-serif; color: #595959;";

/** The margin boxes for one set of header and footer content. With `blank`, boxes it doesn't use are emptied, to override rules from elsewhere. */
function marginBoxes(header: readonly Block[] | undefined, footer: readonly Block[] | undefined, blank: boolean): string {
  const rules: string[] = [];
  for (const [blocks, place] of [[header, "top"], [footer, "bottom"]] as const) {
    const box = marginBoxContent(blocks);
    for (const align of ["left", "center", "right"] as const) {
      if (box && box.align === align) rules.push(`@${place}-${align} { content: ${box.content}; ${BOX_STYLE} }`);
      else if (blank) rules.push(`@${place}-${align} { content: none; }`);
    }
  }
  return rules.join(" ");
}

/**
 * Print rules that put the header and footer in the page margins, on browsers that support margin boxes.
 * The first page and odd and even pages follow the page setup. Only the first line of text of each header
 * or footer can be printed this way; images, columns and other formatting appear in the Word export.
 */
function headerFooterCss(doc: Doc): string {
  const page = doc.page;
  const rules: string[] = [];
  const add = (selector: string, body: string) => body && rules.push(`@page${selector} { ${body} }`);
  if (page?.differentOddEven) {
    add(" :right", marginBoxes(doc.header, doc.footer, false));
    add(" :left", marginBoxes(doc.headerEven, doc.footerEven, false));
  } else {
    add("", marginBoxes(doc.header, doc.footer, false));
  }
  if (page?.differentFirstPage) add(" :first", marginBoxes(doc.headerFirst, doc.footerFirst, true));
  return rules.length > 0 ? `${rules.join("\n")}\n` : "";
}

/** Blocks as HTML, with consecutive list items grouped into nested lists. */
function blocksHtml(doc: Doc, blocks: readonly Block[]): string {
  const out: string[] = [];
  const open: ("bullet" | "ordered")[] = [];
  /** The marker each open list was opened with, so an item that differs says so itself. */
  const markers: (ListMarker | undefined)[] = [];
  const tag = (kind: "bullet" | "ordered") => (kind === "bullet" ? "ul" : "ol");
  // Closing tags attach to the previous line so list items stay compact.
  const append = (html: string) => {
    out[out.length - 1] += html;
  };

  const closeLists = (down: number) => {
    while (open.length > down) {
      append(`</li></${tag(open.pop()!)}>`);
      markers.pop();
    }
  };
  /** Browsers number every ordered list 1. 2. 3. and nest bullets • ◦ ▪, so only a different marker needs saying. */
  const browserMarker = (block: ListItemBlock, depth: number) => (block.list === "ordered" ? "decimal" : defaultMarker("bullet", depth));
  const opener = (block: ListItemBlock, first: boolean) => {
    const marker = markerOf(block);
    const style = marker !== browserMarker(block, block.depth) || defaultMarker(block.list, block.depth) !== browserMarker(block, block.depth) ? ` style="list-style-type:${marker}"` : "";
    const start = first && block.start !== undefined ? ` start="${block.start}"` : "";
    markers.push(marker);
    return `<${tag(block.list)}${start}${style}>`;
  };
  const labels = listLabels(blocks);

  blocks.forEach((block, at) => {
    if (block.type !== "list_item") {
      closeLists(0);
      out.push(blockHtml(doc, block));
      return;
    }
    const target = block.depth + 1;
    closeLists(target);
    let started = false;
    if (open.length === target) {
      if (open[target - 1] === block.list) {
        append("</li>");
      } else {
        append(`</li></${tag(open.pop()!)}>`);
        markers.pop();
        out.push(opener(block, true));
        open.push(block.list);
        started = true;
      }
    }
    while (open.length < target) {
      out.push(opener(block, open.length === target - 1));
      open.push(block.list);
      started = open.length === target;
      if (open.length < target) out.push("<li>");
    }
    const shown = withParagraphStyle(doc, block);
    const own = labels[at]!.marker !== markers[target - 1];
    const value = !started && block.start !== undefined ? ` value="${block.start}"` : "";
    out.push(`<li${value}${styleName(doc, block)}${styleAttr(shown.align, shown.format, own ? [`list-style-type:${labels[at]!.marker}`] : [])}>${inline(block.runs, doc, block)}`);
  });
  closeLists(0);
  return out.join("\n");
}

/** The notes, numbered, after the body: browsers have no footnotes, so they come at the end with links back. */
function footnotesHtml(doc: Doc): string {
  const ids = footnoteIds(doc.blocks);
  const items = ids.flatMap((id, i) => {
    const blocks = doc.footnotes?.[id];
    return blocks ? [`<li id="fn-${i + 1}">${blocksHtml(doc, blocks)} <a class="footnote-back" href="#fnref-${i + 1}">\u21a9</a></li>`] : [];
  });
  return items.length > 0 ? `\n<section class="footnotes">\n<hr>\n<ol>\n${items.join("\n")}\n</ol>\n</section>` : "";
}

/** A name for the pages of each section whose pages are shaped differently from the document's, for CSS named pages. */
function pageNamesOf(doc: Doc, sections: readonly Section[]): Map<Section, string> {
  const names = new Map<Section, string>();
  const first = sectionShape(doc, sections, 0);
  sections.forEach((section, i) => {
    if (i > 0 && !sameShape(sectionShape(doc, sections, i), first)) names.set(section, `section${i + 1}`);
  });
  return names;
}

/** `@page` rules for those sections: their size and margins. The first section's are the plain `@page` above. */
function sectionPageCss(doc: Doc): string {
  const sections = sectionsOf(doc);
  return [...pageNamesOf(doc, sections)]
    .map(([section, name]) => {
      const shape = sectionShape(doc, sections, sections.indexOf(section));
      const { width, height } = pageDimensions(shape as PageSetup);
      const m = shape.margins;
      return `@page ${name} { size: ${width}in ${height}in; margin: ${m.top}in ${m.right}in ${m.bottom}in ${m.left}in; }`;
    })
    .join("\n");
}

/** The body, with each section that has columns or starts a new page wrapped to say so. */
function sectionsHtml(doc: Doc): string {
  const sections = sectionsOf(doc);
  const pageNames = pageNamesOf(doc, sections);
  return sections
    .map((section) => {
      const inner = blocksHtml(doc, doc.blocks.slice(section.from, section.to));
      const style: string[] = [];
      if (section.start?.kind === "next_page") style.push("break-before:page");
      const named = pageNames.get(section);
      if (named) style.push(`page:${named}`);
      const { count, gap, rule } = section.columns;
      if (count > 1) {
        style.push(`column-count:${count}`, `column-gap:${gap}pt`);
        if (rule) style.push("column-rule:1px solid #bbb");
      }
      return style.length > 0 ? `<div class="section" style="${style.join(";")}">\n${inner}\n</div>` : inner;
    })
    .filter((html) => html !== "")
    .join("\n");
}

export function toHtml(source: Doc, options: HtmlOptions = {}): string {
  const doc = numberFootnotes(source);
  const body = sectionsHtml(doc) + footnotesHtml(doc);
  if (!options.fullDocument) return body;

  const page = pageSetupOf(doc);
  const { width, height } = pageDimensions(page);
  const m = page.margins;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.title)}</title>
<style>
@page { size: ${width}in ${height}in; margin: ${m.top}in ${m.right}in ${m.bottom}in ${m.left}in; }
${headerFooterCss(doc)}${sectionPageCss(doc)}
body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.15; }
p { margin: 0 0 8pt; }
img { max-width: 100%; height: auto; }
pre { background: #f2f2f2; padding: 8pt; white-space: pre-wrap; }
table p { margin: 0 0 4pt; }
td > :last-child, th > :last-child { margin-bottom: 0; }
.footnotes { font-size: 9pt; color: #333; }
.footnotes ol { padding-left: 18pt; }
.footnotes p { margin: 0 0 3pt; display: inline; }
sup.footnote-ref a { text-decoration: none; }
blockquote { margin-left: 0; padding-left: 12pt; border-left: 3pt solid #ccc; color: #555; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
