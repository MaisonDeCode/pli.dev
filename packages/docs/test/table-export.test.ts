import { beforeEach, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import { setIdGenerator } from "@pli.dev/core";
import { bold, createDoc, heading, image, listItem, paragraph, table, text, toDocx, toHtml, toMarkdown, type Doc, type TableBlock } from "../src";

beforeEach(() => {
  let n = 0;
  setIdGenerator(() => String(++n));
});

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function sampleTable(): TableBlock {
  const t = table(
    [
      ["Name", "Qty | notes", "Price"],
      [[bold("Widget")], "2", "$4.00"],
      ["Gadget", "10", "$1.50"],
    ],
    { headerRow: true, columns: [2, 1, 1] },
  );
  t.rows[1]!.cells[2]!.shade = "#ffe58f";
  return t;
}

const sampleDoc = (): Doc => createDoc("Report", [heading(1, "Totals"), sampleTable(), paragraph("after the table")]);

describe("HTML", () => {
  it("writes a table with columns, a header row, shading and borders", () => {
    const html = toHtml(sampleDoc());
    expect(html).toContain('<table style="border-collapse:collapse;width:100%;table-layout:fixed">');
    expect(html).toContain('<col style="width:50%"><col style="width:25%"><col style="width:25%">');
    expect(html).toMatch(/<th style="border:1px solid #bfbfbf;padding:4pt 6pt;vertical-align:top;text-align:left;background-color:#f3f4f6"><p>Name<\/p><\/th>/);
    expect(html).toMatch(/<td style="[^"]*background-color:#ffe58f"><p>\$4\.00<\/p><\/td>/);
    expect(html).toContain("<td");
    expect(html).toContain("<strong>Widget</strong>");
  });

  it("honours the border setting, and draws no header without headerRow", () => {
    const t = { ...sampleTable(), borders: "none" as const, headerRow: undefined };
    const html = toHtml(createDoc("T", [t]));
    expect(html).toContain("border:none");
    expect(html).not.toContain("<th");
    const horizontal = toHtml(createDoc("T", [{ ...sampleTable(), borders: "horizontal" as const }]));
    expect(horizontal).toContain("border-top:1px solid #bfbfbf;border-bottom:1px solid #bfbfbf");
  });

  it("groups lists inside cells and escapes cell content", () => {
    const t = table([["x"]]);
    t.rows[0]!.cells[0]!.blocks = [listItem("bullet", "<one>"), listItem("bullet", "two"), image(PNG, { width: 5, height: 5 })];
    const html = toHtml(createDoc("T", [t]));
    expect(html).toContain("<ul>\n<li>&lt;one&gt;</li>\n<li>two</li></ul>");
    expect(html).toContain("<img src=");
  });
});

describe("Markdown", () => {
  it("writes a GFM table with the first row as header, escaping pipes", () => {
    const md = toMarkdown(sampleDoc());
    expect(md).toBe(
      [
        "## Totals".replace("##", "#"),
        "",
        "| Name | Qty \\| notes | Price |",
        "| --- | --- | --- |",
        "| **Widget** | 2 | $4.00 |",
        "| Gadget | 10 | $1.50 |",
        "",
        "after the table",
        "",
      ].join("\n"),
    );
  });

  it("flattens several blocks in a cell and keeps empty cells valid", () => {
    const t = table([["a", ""], ["", "d"]]);
    t.rows[0]!.cells[0]!.blocks.push(listItem("bullet", "more"), image(PNG, { width: 5, height: 5 }, { alt: "dot" }));
    const md = toMarkdown(createDoc("T", [t]));
    expect(md).toContain("| a<br>• more<br>![dot](data:image/png;base64,");
    expect(md).toContain("|   | d |");
  });
});

describe("DOCX", () => {
  const files = (doc: Doc = sampleDoc()) => unzipSync(toDocx(doc));
  const body = (doc?: Doc) => strFromU8(files(doc)["word/document.xml"]!);

  it("is well-formed XML", () => {
    const errors: string[] = [];
    new DOMParser({ onError: (_l, m) => errors.push(m) }).parseFromString(body(), "text/xml");
    expect(errors).toEqual([]);
  });

  it("writes a fixed grid from the text width, with the last column absorbing rounding", () => {
    const xml = body();
    // Letter with 1in margins: 6.5in = 9360 twips, split 2:1:1.
    expect(xml).toContain('<w:tblW w:w="9360" w:type="dxa"/>');
    expect(xml).toContain('<w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="2340"/><w:gridCol w:w="2340"/></w:tblGrid>');
    expect(xml).toContain('<w:tblLayout w:type="fixed"/>');
  });

  it("marks the header row to repeat and bolds and shades it", () => {
    const xml = body();
    expect(xml.match(/<w:tblHeader\/>/g)).toHaveLength(1);
    expect(xml).toContain('<w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>');
    const header = xml.slice(xml.indexOf("<w:tr>"), xml.indexOf("</w:tr>"));
    expect(header).toContain("<w:b/>");
    const secondRow = xml.slice(xml.indexOf("</w:tr>"));
    expect(secondRow.slice(0, secondRow.indexOf("</w:tr>", 8))).not.toContain('w:fill="F3F4F6"');
  });

  it("applies cell shading and border modes", () => {
    expect(body()).toContain('w:fill="FFE58F"');
    expect(body()).toContain('<w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:left w:val="single"');
    const none = body(createDoc("T", [{ ...sampleTable(), borders: "none" }]));
    expect(none).toContain('<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/>');
    const horizontal = body(createDoc("T", [{ ...sampleTable(), borders: "horizontal" }]));
    expect(horizontal).toContain('<w:left w:val="nil"/>');
    expect(horizontal).toContain('<w:insideH w:val="single"');
  });

  it("keeps a paragraph after a table and between two tables", () => {
    const only = body(createDoc("T", [sampleTable()]));
    expect(only).toMatch(/<\/w:tbl><w:p\/>/);
    const twice = body(createDoc("T", [sampleTable(), sampleTable()]));
    expect(twice).toMatch(/<\/w:tbl><w:p\/><w:tbl>/);
  });

  it("writes lists and sized images inside cells", () => {
    const t = table([["x"]]);
    t.rows[0]!.cells[0]!.blocks = [listItem("ordered", "first"), image(PNG, { width: 1000, height: 500 })];
    const xml = body(createDoc("T", [t]));
    expect(xml).toContain('<w:pStyle w:val="ListParagraph"/>');
    expect(xml).toContain("<w:numId");
    // The only cell is 6.5in wide (624px), so a 1000px image is scaled to fit inside it.
    const cx = Number(/<wp:extent cx="(\d+)"/.exec(xml)![1]);
    expect(cx).toBeLessThanOrEqual(624 * 9525);
    expect(cx).toBeGreaterThan(500 * 9525);
    expect(Object.keys(files(createDoc("T", [t])))).toContain("word/media/image1.png");
  });

  it("uses the page's text width, not Letter, for other page setups", () => {
    const doc: Doc = { ...createDoc("T", [sampleTable()]), page: { size: "a4", orientation: "landscape", margins: { top: 1, right: 0.5, bottom: 1, left: 0.5 } } };
    // 11.69 - 1 = 10.69in = 15394 twips.
    expect(body(doc)).toContain('<w:tblW w:w="15394" w:type="dxa"/>');
  });

  it("writes text for every cell", () => {
    const xml = body();
    for (const word of ["Name", "Qty | notes", "Price", "Widget", "Gadget", "$1.50"]) expect(xml).toContain(word);
    expect(text("x").text).toBe("x");
  });
});

describe("merged cells, row heights and vertical alignment", () => {
  /** 3x3 with the top-left 2x2 merged, the right column's first two rows merged, a tall middle row and a centered cell. */
  function merged(): TableBlock {
    const t = table(
      [
        ["A", "B", "C"],
        ["D", "E", "F"],
        ["G", "H", "I"],
      ],
      { headerRow: true },
    );
    const cell = (r: number, c: number) => t.rows[r]!.cells[c]!;
    // Merge (0,0)-(1,1): the origin keeps its first block and takes the rest.
    cell(0, 0).blocks.push(...cell(0, 1).blocks, ...cell(1, 0).blocks, ...cell(1, 1).blocks);
    cell(0, 0).colSpan = 2;
    cell(0, 0).rowSpan = 2;
    for (const [r, c] of [[0, 1], [1, 0], [1, 1]] as const) t.rows[r]!.cells[c] = { id: cell(r, c).id, blocks: [], covered: true };
    // Merge (0,2)-(1,2) vertically.
    cell(0, 2).rowSpan = 2;
    cell(0, 2).blocks.push(...cell(1, 2).blocks);
    t.rows[1]!.cells[2] = { id: cell(1, 2).id, blocks: [], covered: true };
    t.rows[2]!.height = 40;
    t.rows[2]!.cells[1]!.vAlign = "middle";
    t.rows[2]!.cells[2]!.vAlign = "bottom";
    return t;
  }
  const doc = () => createDoc("Merged", [merged()]);

  it("writes colspan and rowspan on the real cell, leaves out the covered squares, and sets height and alignment", () => {
    const html = toHtml(doc());
    expect(html).toMatch(/<th colspan="2" rowspan="2" style="[^"]*"><p>A<\/p>\s*<p>B<\/p>\s*<p>D<\/p>\s*<p>E<\/p><\/th>/);
    expect(html).toMatch(/<th rowspan="2" style="[^"]*"><p>C<\/p>\s*<p>F<\/p><\/th>/);
    // Row 0 has two cells (the merged 2x2 and the merged column), row 1 has none of its own.
    const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g)!;
    expect(rows[0]!.match(/<t[hd]/g)).toHaveLength(2);
    expect(rows[1]!.match(/<t[hd]/g) ?? []).toHaveLength(0);
    expect(rows[2]!.match(/<t[hd]/g)).toHaveLength(3);
    expect(rows[2]).toContain('<tr style="height:40pt">');
    expect(rows[2]).toContain("vertical-align:middle");
    expect(rows[2]).toContain("vertical-align:bottom");
  });

  it("leaves the hidden squares empty in Markdown, so the columns stay aligned", () => {
    const md = toMarkdown(doc());
    const lines = md.trim().split("\n");
    expect(lines[0]).toBe("| A<br>B<br>D<br>E |   | C<br>F |");
    expect(lines[1]).toBe("| --- | --- | --- |");
    expect(lines[2]).toBe("|   |   |   |");
    expect(lines[3]).toBe("| G | H | I |");
  });

  describe("DOCX", () => {
    const xml = () => strFromU8(unzipSync(toDocx(doc()))["word/document.xml"]!);

    it("is well-formed", () => {
      const errors: string[] = [];
      new DOMParser({ onError: (_l, m) => errors.push(m) }).parseFromString(xml(), "text/xml");
      expect(errors).toEqual([]);
    });

    it("spans columns with gridSpan and rows with vMerge, with a continuation cell in each lower row", () => {
      const out = xml();
      // Three equal columns of 6.5in / 3 = 3120 twips. The 2x2 merge is two columns wide, then restarts a vertical merge.
      expect(out).toContain('<w:tcW w:w="6240" w:type="dxa"/><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>');
      // Its continuation in row 1 repeats the width and span, with an empty paragraph.
      expect(out).toContain('<w:tc><w:tcPr><w:tcW w:w="6240" w:type="dxa"/><w:gridSpan w:val="2"/><w:vMerge/></w:tcPr><w:p/></w:tc>');
      // The merged right column is a plain restart/continue pair.
      expect(out).toContain('<w:tcW w:w="3120" w:type="dxa"/><w:vMerge w:val="restart"/>');
      expect(out).toContain('<w:tc><w:tcPr><w:tcW w:w="3120" w:type="dxa"/><w:vMerge/></w:tcPr><w:p/></w:tc>');
    });

    it("keeps every row's cells adding up to the grid", () => {
      const rows = xml().match(/<w:tr>.*?<\/w:tr>/g)!;
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        const cells = [...row.matchAll(/<w:tc>.*?<\/w:tc>/g)].map((m) => m[0]);
        const columns = cells.reduce((n, cell) => n + Number(/<w:gridSpan w:val="(\d+)"/.exec(cell)?.[1] ?? 1), 0);
        expect(columns).toBe(3);
      }
    });

    it("writes row height as a minimum and vertical alignment in the cell properties", () => {
      const out = xml();
      expect(out).toContain('<w:trHeight w:val="800" w:hRule="atLeast"/>');
      expect(out).toContain('<w:vAlign w:val="center"/>');
      expect(out).toContain('<w:vAlign w:val="bottom"/>');
      // vAlign comes after shading in the schema order.
      expect(out).not.toMatch(/<w:vAlign[^>]*\/><w:shd/);
    });
  });
});
