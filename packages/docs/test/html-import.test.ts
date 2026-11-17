import { describe, expect, it } from "vitest";
import { htmlToFragment, type Block, type TableBlock } from "../src";
import { checkGrid } from "../src/grid";

const blocksOf = (html: string) => htmlToFragment(html).blocks;
const textOfBlock = (b: Block) => ("runs" in b ? b.runs.map((r) => r.text).join("") : "");
const table = (html: string): TableBlock => {
  const t = blocksOf(html).find((b): b is TableBlock => b.type === "table");
  if (!t) throw new Error("no table");
  return t;
};

describe("htmlToFragment: text", () => {
  it("reads paragraphs and inline marks", () => {
    const [p] = blocksOf("<p>Hello <b>bold</b> and <i>italic</i> and <u>under</u></p>");
    expect(p!.type).toBe("paragraph");
    expect(textOfBlock(p!)).toBe("Hello bold and italic and under");
    const runs = (p as { runs: { text: string; marks?: Record<string, unknown> }[] }).runs;
    expect(runs.find((r) => r.text === "bold")!.marks).toEqual({ bold: true });
    expect(runs.find((r) => r.text === "italic")!.marks).toEqual({ italic: true });
    expect(runs.find((r) => r.text === "under")!.marks).toEqual({ underline: true });
  });

  it("reads inline CSS and drops the defaults", () => {
    const [p] = blocksOf(
      '<p><span style="font-weight:700;color:#ff0000;font-size:14pt;font-family:Georgia,serif">a</span><span style="font-family:Arial;font-size:11pt;color:#000000">b</span></p>',
    );
    const runs = (p as { runs: { text: string; marks?: Record<string, unknown> }[] }).runs;
    expect(runs[0]!.marks).toEqual({ bold: true, color: "#ff0000", fontSize: 14, fontFamily: "Georgia" });
    expect(runs[1]!.marks).toBeUndefined();
  });

  it("lets font-weight:normal undo an enclosing bold (Google Docs wraps everything in <b>)", () => {
    const html = '<b style="font-weight:normal" id="docs-internal-guid-1"><p><span style="font-weight:700">x</span> y</p></b>';
    const [p] = blocksOf(html);
    const runs = (p as { runs: { text: string; marks?: Record<string, unknown> }[] }).runs;
    expect(runs[0]!.marks).toEqual({ bold: true });
    expect(runs[1]!.marks).toBeUndefined();
  });

  it("reads headings, quotes and code blocks", () => {
    const blocks = blocksOf('<h2>Title</h2><blockquote>Said</blockquote><pre><code class="language-ts">let a = 1;\n  b();\n</code></pre>');
    expect(blocks.map((b) => b.type)).toEqual(["heading", "quote", "code_block"]);
    expect((blocks[0] as { level: number }).level).toBe(2);
    expect(textOfBlock(blocks[2]!)).toBe("let a = 1;\n  b();");
    expect((blocks[2] as { language?: string }).language).toBe("ts");
  });

  it("collapses whitespace but keeps <br> as a line break", () => {
    const [p] = blocksOf("<p>  one\n   two<br>three  </p>");
    expect(textOfBlock(p!)).toBe("one two\nthree");
  });

  it("splits div flow into paragraphs", () => {
    const blocks = blocksOf("<div>one<div>two</div>three</div>");
    expect(blocks.map(textOfBlock)).toEqual(["one", "two", "three"]);
  });

  it("keeps a blank paragraph as a blank line", () => {
    const blocks = blocksOf("<p>a</p><p></p><p>b</p>");
    expect(blocks.map(textOfBlock)).toEqual(["a", "", "b"]);
  });

  it("applies alignment", () => {
    const [p] = blocksOf('<p style="text-align:center">x</p>');
    expect((p as { align?: string }).align).toBe("center");
  });

  it("resolves <style> classes (Excel and Word)", () => {
    const html = "<style>.red{color:#c00000;font-weight:700}</style><p><span class=red>hot</span></p>";
    const [p] = blocksOf(html);
    expect((p as { runs: { marks?: unknown }[] }).runs[0]!.marks).toEqual({ bold: true, color: "#c00000" });
  });

  it("ignores hidden, script and style content", () => {
    const blocks = blocksOf('<p>a</p><script>alert(1)</script><p style="display:none">b</p><style>p{}</style><p hidden>c</p><p>d</p>');
    expect(blocks.map(textOfBlock)).toEqual(["a", "d"]);
  });
});

describe("htmlToFragment: lists", () => {
  it("reads nested lists with depth and kind", () => {
    const blocks = blocksOf("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul><ol><li>one</li></ol>");
    expect(blocks.map((b) => [textOfBlock(b), (b as { list: string }).list, (b as { depth: number }).depth])).toEqual([
      ["a", "bullet", 0],
      ["b", "bullet", 1],
      ["c", "bullet", 0],
      ["one", "ordered", 0],
    ]);
  });

  it("reads Word's mso-list paragraphs and drops the marker text", () => {
    const html = `
      <p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1.<span>&nbsp;&nbsp;</span></span>First</p>
      <p style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">·<span>&nbsp;</span></span>Nested</p>`;
    const blocks = blocksOf(html);
    expect(blocks.map(textOfBlock)).toEqual(["First", "Nested"]);
    expect((blocks[0] as { list: string }).list).toBe("ordered");
    expect((blocks[1] as { list: string; depth: number }).list).toBe("bullet");
    expect((blocks[1] as { depth: number }).depth).toBe(1);
  });
});

describe("htmlToFragment: links and images", () => {
  it("keeps safe links and drops dangerous ones", () => {
    const [p] = blocksOf('<p><a href="https://x.dev/a">ok</a><a href="javascript:alert(1)">bad</a><a href=" JAVASCRIPT:1">worse</a></p>');
    const runs = (p as { runs: { text: string; marks?: { link?: string } }[] }).runs;
    expect(runs.find((r) => r.text === "ok")!.marks?.link).toBe("https://x.dev/a");
    expect(JSON.stringify(runs)).not.toContain("javascript");
    expect(textOfBlock(p!)).toBe("okbadworse");
  });

  it("keeps http and data images with sizes, rejects others", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const frag = htmlToFragment(`<img src="https://x.dev/a.png" width="200" height="100" alt="a"><img src="${png}"><img src="javascript:1"><img src="file:///etc/passwd"><img src="data:text/html;base64,AAAA">`);
    expect(frag.blocks.map((b) => b.type)).toEqual(["image", "image"]);
    const first = frag.blocks[0] as { width: number; height: number; alt?: string };
    expect([first.width, first.height, first.alt]).toEqual([200, 100, "a"]);
    expect(frag.unsizedImages).toEqual([frag.blocks[1]!.id]);
  });
});

describe("htmlToFragment: tables", () => {
  it("reads a plain table with header row from th", () => {
    const t = table("<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>");
    expect(t.rows).toHaveLength(2);
    expect(t.columns).toHaveLength(2);
    expect(t.headerRow).toBe(true);
    expect(textOfBlock(t.rows[1]!.cells[1]!.blocks[0]!)).toBe("2");
    expect(checkGrid(t)).toBeNull();
  });

  it("places colspan and rowspan with covered cells", () => {
    const t = table(
      "<table><tr><td colspan=2>wide</td><td rowspan=2>tall</td></tr><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td><td>e</td></tr></table>",
    );
    expect(t.columns).toHaveLength(3);
    expect(t.rows[0]!.cells[0]!.colSpan).toBe(2);
    expect(t.rows[0]!.cells[1]!.covered).toBe(true);
    expect(t.rows[0]!.cells[2]!.rowSpan).toBe(2);
    expect(t.rows[1]!.cells[2]!.covered).toBe(true);
    expect(textOfBlock(t.rows[1]!.cells[1]!.blocks[0]!)).toBe("b");
    expect(checkGrid(t)).toBeNull();
  });

  it("clamps spans that run past the table and pads short rows", () => {
    const t = table("<table><tr><td rowspan=9 colspan=9>x</td></tr><tr></tr></table>");
    expect(checkGrid(t)).toBeNull();
    const ragged = table("<table><tr><td>1</td><td>2</td><td>3</td></tr><tr><td>1</td></tr></table>");
    expect(ragged.rows[1]!.cells).toHaveLength(3);
    expect(checkGrid(ragged)).toBeNull();
  });

  it("reads shading, vertical alignment, row height and column widths", () => {
    const t = table(
      '<table><colgroup><col width="100"><col width="300"></colgroup><tr style="height:40pt"><td style="background-color:#ffe699;vertical-align:middle">a</td><td valign="bottom" bgcolor="#00b0f0">b</td></tr></table>',
    );
    expect(t.rows[0]!.height).toBe(40);
    expect(t.rows[0]!.cells[0]!.shade).toBe("#ffe699");
    expect(t.rows[0]!.cells[0]!.vAlign).toBe("middle");
    expect(t.rows[0]!.cells[1]!.vAlign).toBe("bottom");
    expect(t.rows[0]!.cells[1]!.shade).toBe("#00b0f0");
    expect(t.columns[1]! / t.columns[0]!).toBeCloseTo(3, 1);
  });

  it("reads an Excel range with class-based formatting", () => {
    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><style>
      td{padding:0;font-size:11pt;font-family:Calibri}
      .head{font-weight:700;background:#d9e1f2}
      .num{text-align:right}
    </style></head><body><table border=0 cellpadding=0 cellspacing=0>
      <col width=64><col width=80>
      <tr height=20><td class=head>Item</td><td class=head>Cost</td></tr>
      <tr height=20><td>Pens</td><td class=num x:num>4.5</td></tr>
    </table></body></html>`;
    const t = table(html);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]!.cells[0]!.shade).toBe("#d9e1f2");
    const head = t.rows[0]!.cells[0]!.blocks[0] as { runs: { marks?: Record<string, unknown> }[] };
    expect(head.runs[0]!.marks).toMatchObject({ bold: true, fontFamily: "Calibri" });
    expect((t.rows[1]!.cells[1]!.blocks[0] as { align?: string }).align).toBe("right");
    expect(t.borders).toBe("none");
  });

  it("flattens a table nested in a cell to text", () => {
    const t = table("<table><tr><td>outer<table><tr><td>in1</td><td>in2</td></tr></table></td></tr></table>");
    expect(t.rows[0]!.cells[0]!.blocks.every((b) => (b.type as string) !== "table")).toBe(true);
    expect(t.rows[0]!.cells[0]!.blocks.map(textOfBlock).join("|")).toContain("in1");
  });

  it("returns no table for an empty one", () => {
    expect(blocksOf("<table></table>")).toEqual([]);
    expect(blocksOf("<table><tr></tr></table>")).toEqual([]);
  });

  it("keeps text before and after a table in order", () => {
    const blocks = blocksOf("<p>before</p><table><tr><td>x</td></tr></table>after");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
  });
});

describe("htmlToFragment: limits", () => {
  it("survives deep nesting and huge spans", () => {
    const deep = "<div>".repeat(5000) + "x" + "</div>".repeat(5000);
    expect(() => htmlToFragment(deep)).not.toThrow();
    const wide = `<table><tr>${"<td>c</td>".repeat(500)}</tr></table>`;
    const t = table(wide);
    expect(t.columns.length).toBeLessThanOrEqual(40);
    expect(checkGrid(t)).toBeNull();
  });

  it("returns nothing for empty or non-HTML input", () => {
    expect(htmlToFragment("").blocks).toEqual([]);
    expect(htmlToFragment("   ").blocks).toEqual([]);
    expect(textOfBlock(htmlToFragment("just text").blocks[0]!)).toBe("just text");
  });
});
