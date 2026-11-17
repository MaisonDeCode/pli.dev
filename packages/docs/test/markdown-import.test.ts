import { describe, expect, it } from "vitest";
import { fromMarkdown, toDocx, toMarkdown, validateDoc, serializeDoc, parseDoc, type Block } from "../src";

const types = (blocks: readonly Block[]) => blocks.map((b) => b.type);
const text = (b: Block | undefined) => (b && "runs" in b ? b.runs.map((r) => r.text).join("") : "");

describe("Markdown into a document", () => {
  it("reads headings, paragraphs and the title", () => {
    const doc = fromMarkdown("# Quarterly report\n\nSales were up.\nAnd costs were down.\n\n## Details\n\nMore.");
    expect(types(doc.blocks)).toEqual(["heading", "paragraph", "heading", "paragraph"]);
    expect(doc.title).toBe("Quarterly report");
    expect(text(doc.blocks[1])).toBe("Sales were up. And costs were down.");
    expect(doc.blocks[2]).toMatchObject({ level: 2 });
    validateDoc(doc);
  });

  it("can make the first heading the title block", () => {
    const doc = fromMarkdown("# Report\n\n## One", { firstHeadingAsTitle: true, title: "Report 2026" });
    expect(types(doc.blocks)).toEqual(["title", "heading"]);
    expect(doc.title).toBe("Report 2026");
  });

  it("reads bold, italic, strikethrough, code, links and escapes, nested", () => {
    const [p] = fromMarkdown("Some **bold and *both*** and _italic_ and ~~gone~~ and `code *x*` and [a link](https://pli.dev \"t\") and snake_case_name and \\*plain\\*").blocks;
    const runs = (p as { runs: { text: string; marks?: Record<string, unknown> }[] }).runs;
    expect(runs.find((r) => r.text === "bold and ")?.marks).toEqual({ bold: true });
    expect(runs.find((r) => r.text === "both")?.marks).toEqual({ bold: true, italic: true });
    expect(runs.find((r) => r.text === "italic")?.marks).toEqual({ italic: true });
    expect(runs.find((r) => r.text === "gone")?.marks).toEqual({ strike: true });
    expect(runs.find((r) => r.text === "code *x*")?.marks).toEqual({ code: true });
    expect(runs.find((r) => r.text === "a link")?.marks).toEqual({ link: "https://pli.dev" });
    expect(runs.map((r) => r.text).join("")).toContain("snake_case_name and *plain*");
  });

  it("reads bulleted and numbered lists, nested by indentation, and where numbering starts", () => {
    const doc = fromMarkdown("- one\n  - nested\n    - deeper\n- two\n\n3. start at three\n4. four\n   continued\n1) restart");
    const items = doc.blocks.filter((b) => b.type === "list_item") as { list: string; depth: number; start?: number; runs: { text: string }[] }[];
    expect(items.map((i) => [i.list, i.depth, text(i as Block)])).toEqual([
      ["bullet", 0, "one"],
      ["bullet", 1, "nested"],
      ["bullet", 2, "deeper"],
      ["bullet", 0, "two"],
      ["ordered", 0, "start at three"],
      ["ordered", 0, "four continued"],
      ["ordered", 0, "restart"],
    ]);
    expect(items[4]).toMatchObject({ start: 3 });
    expect(items[5]).not.toHaveProperty("start");
    validateDoc(doc);
  });

  it("reads quotes, fenced code and rules", () => {
    const doc = fromMarkdown("> A wise line\n> goes on\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n---\n\nAfter");
    expect(types(doc.blocks)).toEqual(["quote", "code_block", "divider", "paragraph"]);
    expect(text(doc.blocks[0])).toBe("A wise line goes on");
    expect(doc.blocks[1]).toMatchObject({ language: "ts" });
    expect(text(doc.blocks[1])).toBe("const a = 1;\n\nconst b = 2;");
  });

  it("reads tables with a header row and column alignment", () => {
    const doc = fromMarkdown("| Item | Qty | Price |\n|:-----|:---:|------:|\n| Pens | 4 | **$2** |\n| Ink \\| blue | 1 | $9 |\n\nAfter");
    const table = doc.blocks[0] as Extract<Block, { type: "table" }>;
    expect(table).toMatchObject({ type: "table", headerRow: true });
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0]!.cells).toHaveLength(3);
    expect(table.rows[1]!.cells[2]!.blocks[0]).toMatchObject({ align: "right" });
    expect(table.rows[1]!.cells[1]!.blocks[0]).toMatchObject({ align: "center" });
    expect(text(table.rows[2]!.cells[0]!.blocks[0])).toBe("Ink | blue");
    expect(types(doc.blocks)).toEqual(["table", "paragraph"]);
    validateDoc(doc);
  });

  it("has a table of contents, page breaks, and sized pictures", () => {
    const doc = fromMarkdown("[TOC]\n\n# A\n\n<!-- pagebreak -->\n\n![A chart](https://example.com/c.png){width=600 height=300}\n\n![Small](data:image/png;base64,AAAA)");
    expect(types(doc.blocks)).toEqual(["toc", "heading", "page_break", "image", "image"]);
    expect(doc.blocks[3]).toMatchObject({ src: "https://example.com/c.png", alt: "A chart", width: 600, height: 300 });
    expect(doc.blocks[4]).toMatchObject({ width: 480, height: 270 });
    validateDoc(doc);
  });

  it("makes a document that saves, exports to Word and back to Markdown", () => {
    const doc = fromMarkdown("# Title\n\nA **bold** claim.\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |");
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
    expect(toDocx(doc).byteLength).toBeGreaterThan(1000);
    expect(toMarkdown(doc)).toContain("**bold**");
  });

  it("copes with nothing, and with odd input", () => {
    expect(fromMarkdown("").blocks).toEqual([]);
    expect(fromMarkdown("").title).toBe("Untitled");
    expect(() => validateDoc(fromMarkdown("**unclosed and `tick and [broken](\n\n|\n|---\n\n- \n\n#"))).not.toThrow();
  });
});
