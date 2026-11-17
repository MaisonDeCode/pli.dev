// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  bold,
  codeBlock,
  createDoc,
  divider,
  heading,
  image,
  italic,
  link,
  listItem,
  pageBreak,
  paragraph,
  quote,
  subtitle,
  table,
  text,
  title,
  toc,
} from "@pli.dev/docs";
import { DocumentView, computeMarkers } from "../src/render";

const html = (doc: ReturnType<typeof createDoc>, placeholder?: string) =>
  renderToStaticMarkup(<DocumentView doc={doc} placeholder={placeholder} />);

describe("DocumentView", () => {
  it("tags every block with its id and type", () => {
    const p = paragraph("hi");
    expect(html(createDoc("T", [p]))).toBe(`<p data-block-id="${p.id}" data-type="paragraph">hi</p>`);
  });

  it("nests marks and renders links safely", () => {
    const p = paragraph([
      text("a", { bold: true, italic: true, color: "#f00" }),
      link("b", "https://pli.dev"),
      link("c", "javascript:alert(1)"),
    ]);
    const out = html(createDoc("T", [p]));
    expect(out).toContain('<span style="color:#f00"><em><strong>a</strong></em></span>');
    expect(out).toContain('<a href="https://pli.dev" rel="noopener noreferrer">b</a>');
    expect(out).toContain('<a href="#" rel="noopener noreferrer">c</a>');
  });

  it("adds a <br> to empty blocks and after a trailing line break, but never adds text", () => {
    const empty = html(createDoc("T", [paragraph("")]));
    expect(empty).toContain("<br/>");
    const trailing = html(createDoc("T", [codeBlock("a\n")]));
    expect(trailing).toContain("a\n<br/>");
    expect(html(createDoc("T", [paragraph("x")]))).not.toContain("<br");
  });

  it("renders headings, quotes, code and dividers", () => {
    const out = html(createDoc("T", [heading(2, "H", "center"), quote("Q"), codeBlock("c", "ts"), divider()]));
    expect(out).toContain('<h2 data-block-id=');
    expect(out).toContain("text-align:center");
    expect(out).toContain("<blockquote");
    expect(out).toContain('<pre data-block-id');
    expect(out).toContain('data-language="ts"');
    expect(out).toContain("<hr");
  });

  it("groups consecutive list items and draws markers with data attributes, not text", () => {
    const out = html(
      createDoc("T", [
        listItem("ordered", "one"),
        listItem("ordered", "two"),
        listItem("bullet", "nested", 1),
        paragraph("break"),
        listItem("ordered", "restart"),
      ]),
    );
    expect(out.match(/role="list"/g)).toHaveLength(2);
    expect(out).toContain('data-marker="1."');
    expect(out).toContain('data-marker="2."');
    expect(out).toContain('data-marker="◦"');
    expect(out.indexOf('data-marker="1."', out.indexOf("break"))).toBeGreaterThan(0);
  });

  it("shows the placeholder only for a single empty paragraph", () => {
    expect(html(createDoc("T", [paragraph("")]), "Type here")).toContain('data-placeholder="Type here"');
    expect(html(createDoc("T", [paragraph("x")]), "Type here")).not.toContain("data-placeholder");
    expect(html(createDoc("T", [paragraph(""), paragraph("")]), "Type here")).not.toContain("data-placeholder");
  });
});

describe("computeMarkers", () => {
  it("numbers per level, restarts after other blocks, and varies style by depth", () => {
    const blocks = [
      listItem("ordered", "a"),
      listItem("ordered", "b", 1),
      listItem("ordered", "c", 1),
      listItem("ordered", "d", 2),
      listItem("ordered", "e"),
      paragraph("x"),
      listItem("ordered", "f"),
      listItem("bullet", "g", 3),
    ];
    expect(computeMarkers(blocks)).toEqual(["1.", "a.", "b.", "i.", "2.", undefined, "1.", "•"]);
  });

  it("keeps the style of bold and italic runs untouched", () => {
    expect(html(createDoc("T", [paragraph([bold("x"), italic("y")])]))).toContain("<strong>x</strong>");
  });
});

describe("DocumentView: pages, images, TOC and fields", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  it("puts a gap element before a block that the layout moved", () => {
    const a = paragraph("one");
    const b = paragraph("two");
    const out = renderToStaticMarkup(
      <DocumentView doc={createDoc("T", [a, b])} layout={{ before: new Map([[b.id, 120]]), splits: new Map(), pageOf: new Map() }} />,
    );
    expect(out).toMatch(/<\/p><div class="pli-spacer" data-pli-spacer="" contentEditable="false" aria-hidden="true" style="height:120px"><\/div><p data-block-id="[^"]+" data-type="paragraph">two/);
  });

  it("splits a paragraph with a gap inside it without changing its text", () => {
    const p = paragraph(["Hello ", bold("brave new"), " world"]);
    const out = renderToStaticMarkup(
      <DocumentView doc={createDoc("T", [p])} layout={{ before: new Map(), splits: new Map([[p.id, [{ offset: 12, height: 200 }]]]), pageOf: new Map() }} />,
    );
    expect(out).toContain('<strong>brave </strong><span class="pli-spacer pli-spacer-inline"');
    expect(out).toContain("<strong>new</strong>");
    const dom = document.createElement("div");
    dom.innerHTML = out;
    expect(dom.textContent).toBe("Hello brave new world");
    expect(dom.querySelectorAll("[data-pli-spacer]")).toHaveLength(1);
  });

  it("splits exactly on a run boundary and ignores offsets past the end", () => {
    const p = paragraph(["ab", bold("cd")]);
    const out = renderToStaticMarkup(
      <DocumentView doc={createDoc("T", [p])} layout={{ before: new Map(), splits: new Map([[p.id, [{ offset: 2, height: 5 }, { offset: 99, height: 5 }]]]), pageOf: new Map() }} />,
    );
    expect(out.match(/data-pli-spacer/g)).toHaveLength(1);
    expect(out).toContain('ab<span class="pli-spacer pli-spacer-inline"');
  });

  it("shows real values for page-number fields on static pages, and the cached text while editing", () => {
    const doc = createDoc("T", [paragraph(["Page ", text("1", { field: "page" }), " of ", text("1", { field: "pages" })])]);
    const fixed = renderToStaticMarkup(<DocumentView doc={doc} fields={{ page: 3, pages: 9 }} />);
    expect(fixed).toContain('data-field="page">3<');
    expect(fixed).toContain('data-field="pages">9<');
    const editing = renderToStaticMarkup(<DocumentView doc={doc} />);
    expect(editing).toContain('data-field="page">1<');
  });

  it("renders fonts, sizes, sub and superscript, and paragraph spacing", () => {
    const p = {
      ...paragraph([text("x", { fontFamily: "Georgia", fontSize: 14, superscript: true }), text("2", { subscript: true })]),
      format: { lineHeight: 1.5, spaceBefore: 6, spaceAfter: 12, indentLeft: 36, indentFirst: 18 },
      align: "justify" as const,
    };
    const out = renderToStaticMarkup(<DocumentView doc={createDoc("T", [p])} />);
    expect(out).toContain("font-family:Georgia, Gelasio, &quot;Times New Roman&quot;, serif;font-size:14pt");
    expect(out).toContain("<sup>");
    expect(out).toContain("<sub>");
    expect(out).toContain("text-align:justify;line-height:1.5;padding-top:6pt;margin-bottom:12pt;margin-left:36pt;text-indent:18pt");
  });

  it("renders title, subtitle, page breaks and images with safe sources", () => {
    const img = image(PNG, { width: 40, height: 20 }, { alt: "dot", align: "center" });
    const bad = image("javascript:alert(1)", { width: 5, height: 5 });
    const out = renderToStaticMarkup(
      <DocumentView doc={createDoc("T", [title("T"), subtitle("S"), pageBreak(), img, bad])} selectedId={img.id} onResizeImage={() => undefined} />,
    );
    expect(out).toContain('class="pli-title"');
    expect(out).toContain('class="pli-subtitle"');
    expect(out).toContain('class="pli-page-break"');
    expect(out).toContain('alt="dot"');
    expect(out).toContain("text-align:center");
    expect(out.match(/pli-image-handle /g)).toHaveLength(4);
    expect(out).not.toContain("javascript:");
    expect(out.match(/<img /g)).toHaveLength(2);
    expect(out.match(/<img [^>]*src=/g)).toHaveLength(1);
  });

  it("renders tables with cells, a header row, shading and a copy of the header where a page break splits it", () => {
    const t = table([["Name", "Qty"], ["a", "1"], ["b", "2"]], { headerRow: true, columns: [3, 1] });
    t.rows[1]!.cells[0]!.shade = "#ffe58f";
    const second = t.rows[2]!.id;
    const out = renderToStaticMarkup(
      <DocumentView
        doc={createDoc("T", [t])}
        layout={{ before: new Map([[second, 100]]), splits: new Map(), pageOf: new Map(), repeats: new Map([[second, 30]]) }}
        selectedCells={new Set([t.rows[1]!.cells[1]!.id])}
        onResizeColumns={() => undefined}
      />,
    );
    expect(out).toContain('data-type="table"');
    expect(out).toContain('<col style="width:75%"/><col style="width:25%"/>');
    expect(out).toContain("data-header");
    expect(out).toContain("background-color:#ffe58f");
    expect(out).toContain(`data-cell-id="${t.rows[1]!.cells[1]!.id}" data-selected-cell=""`);
    // The gap before row 2 is 100 tall: 70 of blank space, then a 30px copy of the header.
    expect(out).toContain('class="pli-spacer-row" data-pli-spacer="" aria-hidden="true"><td colSpan="2" contentEditable="false" style="height:70px"');
    expect(out).toContain('class="pli-repeat-row"');
    expect(out.match(/Name/g)).toHaveLength(2);
    expect(out.match(/pli-col-resizer/g)).toHaveLength(3);
    // The copy has no block ids, so selection mapping never sees it.
    expect(out.match(/data-block-id/g)?.length).toBe(1 + 6);
  });

  it("renders merged cells with spans, leaves out the squares they cover, and sets height and alignment", () => {
    const t = table([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]], { headerRow: true });
    // Merge a, b, d, e into one 2x2 cell.
    const cell = (r: number, c: number) => t.rows[r]!.cells[c]!;
    cell(0, 0).colSpan = 2;
    cell(0, 0).rowSpan = 2;
    for (const [r, c] of [[0, 1], [1, 0], [1, 1]] as const) t.rows[r]!.cells[c] = { id: cell(r, c).id, blocks: [], covered: true };
    t.rows[2]!.height = 40;
    t.rows[2]!.cells[1]!.vAlign = "middle";
    const out = renderToStaticMarkup(<DocumentView doc={createDoc("T", [t])} onResizeColumns={() => undefined} onResizeRow={() => undefined} />);
    expect(out).toContain('colSpan="2" rowSpan="2"');
    // 9 squares, 3 of them covered: 6 cells are drawn.
    expect(out.match(/data-cell-id/g)).toHaveLength(6);
    expect(out).toContain('style="height:40pt"');
    expect(out).toContain("vertical-align:middle");
    // Column handles: the merged cell (its right edge is the boundary after column 1) and g and h in
    // the last row. The cells in the last column have no border to drag.
    expect(out.match(/pli-col-resizer/g)).toHaveLength(3);
    // A handle for the bottom edge of every drawn cell.
    expect(out.match(/pli-row-resizer/g)).toHaveLength(6);
  });

  it("keeps the repeated header's spans, and draws only its real cells", () => {
    const t = table([["a", "b", "c"], ["x", "y", "z"], ["p", "q", "r"]], { headerRow: true });
    t.rows[0]!.cells[0]!.colSpan = 2;
    t.rows[0]!.cells[1] = { id: t.rows[0]!.cells[1]!.id, blocks: [], covered: true };
    const second = t.rows[2]!.id;
    const out = renderToStaticMarkup(
      <DocumentView
        doc={createDoc("T", [t])}
        layout={{ before: new Map([[second, 100]]), splits: new Map(), pageOf: new Map(), repeats: new Map([[second, 30]]) }}
      />,
    );
    const copy = /<tr class="pli-repeat-row"[^>]*>(.*?)<\/tr>/.exec(out)![1]!;
    expect(copy.match(/<td/g)).toHaveLength(2);
    expect(copy).toContain('colSpan="2"');
  });

  it("builds a table of contents from headings up to its depth, with page numbers when paginated", () => {
    const h1 = heading(1, "One");
    const h2 = heading(2, "Two");
    const h3 = heading(3, "Three");
    const t = toc(2, "Contents");
    const pageOf = new Map([[h1.id, 1], [h2.id, 2], [h3.id, 3]]);
    const out = renderToStaticMarkup(
      <DocumentView doc={createDoc("T", [t, h1, h2, h3])} layout={{ before: new Map(), splits: new Map(), pageOf }} />,
    );
    expect(out).toContain("Contents");
    expect(out).toContain(`data-toc-target="${h1.id}"`);
    expect(out).toContain(`data-toc-target="${h2.id}"`);
    expect(out).not.toContain(`data-toc-target="${h3.id}"`);
    expect(out).toMatch(/One<\/span><span class="pli-toc-page">1<\/span>/);
    expect(out).toMatch(/Two<\/span><span class="pli-toc-page">2<\/span>/);
    expect(renderToStaticMarkup(<DocumentView doc={createDoc("T", [t, h1])} />)).not.toContain("pli-toc-page");
  });
});
