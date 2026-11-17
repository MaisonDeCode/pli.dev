import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DocumentSession, createDoc, htmlToFragment, listLabels, paragraph, plainText, validateDoc, type Block } from "../src";

const blocksOf = (html: string) => htmlToFragment(html).blocks;
const types = (html: string) => blocksOf(html).map((b) => b.type);
const text = (b: Block) => plainText((b as unknown as { runs: Parameters<typeof plainText>[0] }).runs);

const GOOGLE = (inner: string) => `<meta charset='utf-8'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234">${inner}</b>`;
const P = (s: string, extra = "") => `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;${extra}"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;white-space:pre-wrap;">${s}</span></p>`;

describe("page and section breaks in pasted HTML", () => {
  it("makes a page break of the rule or line break an application uses for one", () => {
    expect(types(GOOGLE(P("One") + '<hr style="page-break-before:always;display:none;">' + P("Two")))).toEqual(["paragraph", "page_break", "paragraph"]);
    expect(types(GOOGLE(P("One") + '<br style="page-break-before:always;">' + P("Two")))).toEqual(["paragraph", "page_break", "paragraph"]);
    expect(types(GOOGLE(P("One") + '<hr style="page-break-after:always;">' + P("Two")))).toEqual(["paragraph", "page_break", "paragraph"]);
    expect(types('<p>One</p><div class="page-break"></div><p>Two</p>')).toEqual(["paragraph", "page_break", "paragraph"]);
    expect(types('<p>One</p><div style="break-after: page"></div><p>Two</p>')).toEqual(["paragraph", "page_break", "paragraph"]);
  });

  it("breaks before a paragraph that asks to start a page, and after one that asks to end it", () => {
    expect(types('<p>One</p><p style="page-break-before:always">Two</p>')).toEqual(["paragraph", "page_break", "paragraph"]);
    expect(types('<p style="page-break-after:always">One</p><p>Two</p>')).toEqual(["paragraph", "page_break", "paragraph"]);
  });

  it("makes a section break of what Word writes for one", () => {
    const html = `<div class=WordSection1><p>One</p></div><br clear=all style='page-break-before:always;mso-break-type:section-break'><div class=WordSection2><p>Two</p></div>`;
    expect(blocksOf(html).map((b) => (b.type === "section_break" ? `section_break:${b.kind}` : b.type))).toEqual(["paragraph", "section_break:next_page", "paragraph"]);
    const continuous = `<p>One</p><br clear=all style='mso-break-type:section-break'><p>Two</p>`;
    expect(blocksOf(continuous).map((b) => (b.type === "section_break" ? `section_break:${b.kind}` : b.type))).toEqual(["paragraph", "section_break:continuous", "paragraph"]);
  });

  it("doesn't start with a break, repeat one, or put one where it can't go", () => {
    expect(types('<hr style="page-break-before:always"><p>One</p>')).toEqual(["paragraph"]);
    expect(types('<p>One</p><hr style="page-break-before:always"><hr style="page-break-before:always"><p>Two</p>')).toEqual(["paragraph", "page_break", "paragraph"]);
    const table = blocksOf('<table><tr><td><p>a</p><hr style="page-break-before:always"><p>b</p></td></tr></table>');
    expect(JSON.stringify(table)).not.toContain("page_break");
  });

  it("still makes a plain rule a divider", () => {
    expect(types("<p>One</p><hr><p>Two</p>")).toEqual(["paragraph", "divider", "paragraph"]);
  });

  it("pastes into a document as breaks that are valid", () => {
    const session = new DocumentSession(createDoc("T", [paragraph("")]));
    const id = session.state.blocks[0]!.id;
    session.select({ anchor: { block: id, offset: 0 }, focus: { block: id, offset: 0 } });
    session.paste({ html: GOOGLE(P("One") + '<hr style="page-break-before:always;display:none;">' + P("Two")) });
    expect(session.state.blocks.map((b) => b.type)).toContain("page_break");
    validateDoc(session.state);
  });
});

describe("pictures that text wraps around, in pasted HTML", () => {
  const img = (style: string, attrs = "") => `<img src="data:image/png;base64,iVBORw0KGgo=" width="100" height="50" ${attrs} style="${style}">`;

  it("keeps a float on the picture", () => {
    expect(blocksOf(`<p>${img("float:left")}Some text</p>`).find((b) => b.type === "image")).toMatchObject({ wrap: "left" });
    expect(blocksOf(`<p>${img("float:right;margin:0 0 8px 14px")}Some text</p>`).find((b) => b.type === "image")).toMatchObject({ wrap: "right" });
  });

  it("keeps the old align attribute, and a float on the element around the picture", () => {
    expect(blocksOf(`<p>${img("", 'align="right"')}x</p>`).find((b) => b.type === "image")).toMatchObject({ wrap: "right" });
    expect(blocksOf(`<p><span style="float:left;display:inline-block">${img("")}</span>text</p>`).find((b) => b.type === "image")).toMatchObject({ wrap: "left" });
  });

  it("leaves a picture without a float on its line", () => {
    expect(blocksOf(`<p>${img("")}</p>`).find((b) => b.type === "image")).not.toHaveProperty("wrap");
  });

  it("floats a picture in a table cell too", () => {
    const table = blocksOf(`<table><tr><td>${img("float:left")}</td></tr></table>`)[0] as unknown as { rows: { cells: { blocks: Block[] }[] }[] };
    expect(JSON.stringify(table)).toContain('"wrap":"left"');
  });
});

describe("a table of contents in pasted HTML", () => {
  const entry = (href: string, title: string, leader: string, indent = 0) =>
    `<p dir="ltr" style="margin-left:${indent}pt;"><span><a href="${href}"><span>${title}</span></a></span><span style="white-space:pre"> ${leader} </span><span>1</span></p>`;
  const google = (id: string) => `https://www.google.com/url?q=https://docs.google.com/document/d/ABC/edit%23heading%3Dh.${id}&sa=D&source=editors&ust=1`;

  it("becomes a table of contents block, with its title", () => {
    const html = GOOGLE(P("Table of contents") + entry(google("a1"), "Introduction", "..........") + entry(google("b2"), "Methods", "..........", 18) + entry(google("c3"), "Results", "..........", 18) + P("Body text"));
    const blocks = blocksOf(html);
    expect(blocks.map((b) => b.type)).toEqual(["toc", "paragraph"]);
    expect(blocks[0]).toMatchObject({ type: "toc", title: "Table of contents", levels: 2 });
    expect(text(blocks[1]!)).toBe("Body text");
  });

  it("works for Word's and LibreOffice's links, and for a plain fragment link", () => {
    expect(types(`${entry("#_Toc123", "One", "")}${entry("#_Toc124", "Two", "")}`)).toEqual(["toc"]);
    expect(types(`${entry("#__RefHeading___Toc1", "One", "")}${entry("#__RefHeading___Toc2", "Two", "")}`)).toEqual(["toc"]);
    expect(types(`${entry("https://docs.google.com/document/d/ABC/edit#heading=h.q", "One", "")}${entry("https://docs.google.com/document/d/ABC/edit#heading=h.r", "Two", "")}`)).toEqual(["toc"]);
  });

  it("takes one entry only when it is under a title", () => {
    expect(types(P("Contents") + entry("#_Toc1", "Only", ""))).toEqual(["toc"]);
    expect(types(entry("#_Toc1", "Only", "") + P("Body"))).toEqual(["paragraph", "paragraph"]);
  });

  it("leaves ordinary links alone, and lines that have more than a leader after the link", () => {
    expect(types(`<p><a href="https://pli.dev">Pli</a> 1</p><p><a href="https://pli.dev/x">More</a> 2</p>`)).toEqual(["paragraph", "paragraph"]);
    expect(types(`<p><a href="#heading=h.a">Intro</a> and then some words</p><p><a href="#heading=h.b">Next</a> more words</p>`)).toEqual(["paragraph", "paragraph"]);
  });

  it("is a table of contents in the document it is pasted into", () => {
    const session = new DocumentSession(createDoc("T", [paragraph("")]));
    const id = session.state.blocks[0]!.id;
    session.select({ anchor: { block: id, offset: 0 }, focus: { block: id, offset: 0 } });
    session.paste({ html: `${entry("#_Toc1", "One", "")}${entry("#_Toc2", "Two", "")}` });
    expect(session.state.blocks.some((b) => b.type === "toc")).toBe(true);
    validateDoc(session.state);
  });
});

describe("a real Google Docs copy with a contents list", () => {
  const dir = "test/fixtures/clipboard/google-docs-wrap-breaks-toc";
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", dir, "text.html"), "utf8");
  const blocks = htmlToFragment(html).blocks;

  it("turns the contents list of links into one table of contents with two levels", () => {
    const tocs = blocks.filter((b) => b.type === "toc");
    expect(tocs).toHaveLength(1);
    expect(tocs[0]).toMatchObject({ levels: 2 });
    const entries = blocks.filter((b) => b.type === "paragraph").map((b) => text(b));
    expect(entries.filter((w) => /^(Overview|Goals|Milestones)\b/.test(w))).toEqual([]); // the list entries are gone; the headings below stay
    expect(blocks.filter((b) => b.type === "heading").map((b) => text(b))).toContain("Overview");
  });

  it("keeps the pictures in line, as the copy gives them no wrapping", () => {
    const images = blocks.filter((b) => b.type === "image");
    expect(images).toHaveLength(2);
    expect(images.every((b) => !("wrap" in b))).toBe(true);
  });
});

describe("a real Google Docs copy with a wrapped picture", () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/clipboard/google-docs-wrap-and-breaks/text.html"), "utf8");
  const blocks = htmlToFragment(html).blocks;

  it("brings the picture in wrapped on the left, in front of the paragraph it sits in", () => {
    const at = blocks.findIndex((b) => b.type === "image" && (b as { wrap?: string }).wrap === "left");
    expect(at).toBeGreaterThan(0);
    expect(blocks.filter((b) => b.type === "image").map((b) => (b as { wrap?: string }).wrap)).toEqual([undefined, undefined, "left"]);
    expect(blocks[at - 1]!.type).toBe("heading");
    expect(text(blocks[at + 1]!)).toMatch(/^Nam liber tempor .* facer possim assum\./);
  });

  it("still turns the contents list into a table of contents", () => {
    expect(blocks.filter((b) => b.type === "toc")).toHaveLength(1);
  });
});

describe("a floated picture in the middle of a paragraph", () => {
  it("goes in front of the paragraph and leaves the sentence whole", () => {
    const out = blocksOf(`<p>Before <img src="data:image/png;base64,iVBORw0KGgo=" width="40" height="20" style="float:right"> after.</p>`);
    expect(out.map((b) => b.type)).toEqual(["image", "paragraph"]);
    expect((out[0] as { wrap?: string }).wrap).toBe("right");
    expect(text(out[1]!)).toBe("Before after.");
  });
});

describe("a real Word copy with a numbered list and a table", () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/clipboard/word-lists-table/text.html"), "utf8");
  const blocks = htmlToFragment(html).blocks;

  it("makes the list real, without the number Word typed in front of each item", () => {
    const items = blocks.filter((b) => b.type === "list_item");
    expect(items.map((b) => text(b))).toEqual(["One", "Two", "Three more more more more words"]);
    expect(items.every((b) => (b as { list: string }).list === "ordered")).toBe(true);
  });

  it("brings the table in with its rows and five equal columns", () => {
    const table = blocks.find((b) => b.type === "table") as { rows: unknown[]; columns: number[] };
    expect(table.rows).toHaveLength(3);
    expect(table.columns).toHaveLength(5);
  });
});

describe("a real Excel copy of a styled range", () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/clipboard/excel-range/text.html"), "utf8");
  const blocks = htmlToFragment(html).blocks;
  type Cell = { covered?: boolean; colSpan?: number; blocks: { runs: { text: string; marks?: Record<string, unknown> }[] }[] };
  const table = blocks.find((b) => b.type === "table") as unknown as { columns: number[]; rows: { cells: Cell[] }[] };

  it("is one table with the six columns and eight rows that were copied, blank ones too, wider ones wider", () => {
    expect(blocks.filter((b) => b.type === "table")).toHaveLength(1);
    expect(table.rows).toHaveLength(8);
    expect(table.columns).toHaveLength(6);
    expect(table.columns[2]!).toBeGreaterThan(table.columns[3]!);
  });

  it("keeps the styles Excel wrote in its style block: bold titles, sizes and colours", () => {
    const title = table.rows[0]!.cells[0]!.blocks[0]!.runs[0]!;
    expect(title.text).toBe("TASK OR TITLE");
    expect(title.marks).toMatchObject({ bold: true, fontSize: 13 });
    expect(table.rows[3]!.cells[1]!.blocks[0]!.runs[0]!.marks).toMatchObject({ color: "#1c639e" });
  });

  it("merges the cell Excel spreads across two columns", () => {
    expect(table.rows[1]!.cells[0]!.colSpan).toBe(2);
    expect(table.rows[1]!.cells[1]!.covered).toBe(true);
  });
});

describe("a real Numbers copy of a table", () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/clipboard/numbers-sample/text.html"), "utf8");
  const blocks = htmlToFragment(html).blocks;
  type Cell = { shade?: string; vAlign?: string; blocks: { align?: string; runs: { text: string; marks?: Record<string, unknown> }[] }[] };
  const table = blocks.find((b) => b.type === "table") as unknown as { columns: number[]; rows: { cells: Cell[] }[] };

  it("is one table of 14 columns and 12 rows, the first column the widest", () => {
    expect(blocks.filter((b) => b.type === "table")).toHaveLength(1);
    expect(table.columns).toHaveLength(14);
    expect(table.rows).toHaveLength(12);
    expect(Math.max(...table.columns)).toBe(table.columns[0]);
  });

  it("keeps the shaded, bold header cells with their font, colour, size and centring", () => {
    const head = table.rows[0]!.cells;
    expect(head[0]!.shade).toBe("#ccffa4");
    expect(head[0]!.blocks[0]!.runs[0]).toMatchObject({ text: "Bill", marks: { bold: true, fontSize: 10, color: "#151515" } });
    expect(head[2]!.blocks[0]!.align).toBe("center");
  });

  it("keeps vertical alignment, and brings the body rows in as plain text", () => {
    expect(table.rows[2]!.cells[0]!.vAlign).toBe("middle");
    expect(table.rows[2]!.cells[1]!.blocks[0]!.runs.map((r) => r.text).join("")).toBe("$0.00");
    expect(table.rows[2]!.cells[0]!.blocks[0]!.runs[0]!.marks).not.toHaveProperty("bold");
  });
});

describe("a real Word copy of a whole test document", () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/clipboard/word-document/text.html"), "utf8");
  const blocks = htmlToFragment(html).blocks;
  const labels = listLabels(blocks).flatMap((l, i) => (l ? [`${l.text} ${text(blocks[i]!)}`] : []));

  it("numbers every list as Word shows it: nested levels, carrying on, capital letters from G, and a restart", () => {
    expect(labels).toEqual([
      "• First bullet", "◦ Nested bullet", "• Second bullet",
      "1. One", "2. Two", "a. Nested a", "b. Nested b", "3. Three",
      "4. Four (carries on)", "5. Five",
      "G. Seventh letter", "H. Eighth letter",
      "i. First", "ii. Second", "i. Restarted", "ii. Next",
    ]);
  });

  it("reads Word's title, subtitle and quotation styles as such", () => {
    expect(blocks.slice(0, 2).map((b) => b.type)).toEqual(["title", "subtitle"]);
    expect(blocks.find((b) => b.type === "quote")).toBeDefined();
  });

  it("makes the contents list, the table, the breaks and the headings", () => {
    const types = blocks.map((b) => b.type);
    expect(types.filter((t) => t === "toc")).toHaveLength(1);
    expect(types).toEqual(expect.arrayContaining(["table", "page_break", "section_break", "image"]));
    expect(blocks.filter((b) => b.type === "heading").map((b) => text(b))).toContain("A table");
  });

  it("sizes the picture as Word does: a 225 by 90 point picture is 300 by 120 pixels", () => {
    const picture = blocks.find((b) => b.type === "image") as unknown as { width: number; height: number };
    expect([picture.width, picture.height]).toEqual([300, 120]);
  });
});
