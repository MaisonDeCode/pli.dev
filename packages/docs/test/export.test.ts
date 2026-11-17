import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import {
  bold,
  code,
  codeBlock,
  createDoc,
  divider,
  heading,
  italic,
  link,
  listItem,
  paragraph,
  quote,
  text,
  toDocx,
  toHtml,
  toMarkdown,
} from "../src";

const sample = () =>
  createDoc("Quarterly <Report>", [
    heading(1, "Report"),
    paragraph(["Plain, ", bold("bold"), ", ", italic("italic"), " and ", code("code"), "."]),
    paragraph(["See ", link("the docs", "https://pli.dev/docs"), "."]),
    listItem("bullet", "One"),
    listItem("bullet", "Nested", 1),
    listItem("bullet", "Two"),
    listItem("ordered", "First"),
    listItem("ordered", "Second"),
    paragraph("Between"),
    listItem("ordered", "Restarts"),
    quote("Quoted"),
    codeBlock("const a = `x`;", "ts"),
    divider(),
  ]);

describe("toMarkdown", () => {
  it("renders every block type", () => {
    expect(toMarkdown(sample())).toBe(
      [
        "# Report",
        "",
        "Plain, **bold**, *italic* and `code`.",
        "",
        "See [the docs](https://pli.dev/docs).",
        "",
        "- One",
        "   - Nested",
        "- Two",
        "1. First",
        "2. Second",
        "",
        "Between",
        "",
        "1. Restarts",
        "",
        "> Quoted",
        "",
        "```ts",
        "const a = `x`;",
        "```",
        "",
        "---",
        "",
      ].join("\n"),
    );
  });

  it("keeps whitespace outside emphasis markers", () => {
    const md = toMarkdown(createDoc("T", [paragraph(["a", text(" b ", { bold: true }), "c"])]));
    expect(md).toBe("a **b** c\n");
  });

  it("escapes text that would become markup", () => {
    const md = toMarkdown(createDoc("T", [paragraph("# not a heading"), paragraph("1. not a list"), paragraph("a*b*")]));
    expect(md).toBe("\\# not a heading\n\n1\\. not a list\n\na\\*b\\*\n");
  });

  it("uses a longer fence when code contains backticks", () => {
    const md = toMarkdown(createDoc("T", [codeBlock("```\nx\n```")]));
    expect(md.startsWith("````\n")).toBe(true);
  });
});

describe("toHtml", () => {
  it("renders inline marks and nested lists", () => {
    const html = toHtml(sample());
    expect(html).toMatch(/<h1 id="h-[^"]+">Report<\/h1>/);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://pli.dev/docs">the docs</a>');
    expect(html).toContain("<ul>\n<li>One\n<ul>\n<li>Nested</li></ul></li>\n<li>Two</li></ul>");
    expect(html).toContain("<ol>\n<li>First</li>\n<li>Second</li></ol>");
    expect(html).toContain('<pre><code class="language-ts">const a = `x`;</code></pre>');
  });

  it("escapes content and blocks script links", () => {
    const html = toHtml(
      createDoc("T", [paragraph(["<img onerror=x>", link("click", "javascript:alert(1)")])]),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img onerror=x&gt;");
    expect(html).toContain('href="#"');
  });

  it("wraps a full document with an escaped title", () => {
    const html = toHtml(sample(), { fullDocument: true });
    expect(html).toContain("<title>Quarterly &lt;Report&gt;</title>");
  });
});

describe("toDocx", () => {
  const files = () => unzipSync(toDocx(sample()));
  const xml = (name: string) => strFromU8(files()[name]!);

  it("contains every required package part", () => {
    expect(Object.keys(files()).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "word/_rels/document.xml.rels",
      "word/document.xml",
      "word/fontTable.xml",
      "word/numbering.xml",
      "word/settings.xml",
      "word/styles.xml",
    ]);
  });

  it("produces well-formed XML in every part", () => {
    for (const name of Object.keys(files())) {
      const errors: string[] = [];
      new DOMParser({ onError: (_level, msg) => errors.push(msg) }).parseFromString(xml(name), "text/xml");
      expect(errors, name).toEqual([]);
    }
  });

  it("maps content to Word structures", () => {
    const doc = xml("word/document.xml");
    expect(doc).toContain('<w:pStyle w:val="Heading1"/>');
    expect(doc).toContain("<w:b/>");
    expect(doc).toContain('<w:hyperlink r:id="rIdLink1">');
    expect(xml("word/_rels/document.xml.rels")).toContain(
      'Target="https://pli.dev/docs" TargetMode="External"',
    );
    expect(xml("docProps/core.xml")).toContain("<dc:title>Quarterly &lt;Report&gt;</dc:title>");
  });

  it("restarts numbering for separate ordered lists", () => {
    const doc = xml("word/document.xml");
    expect(doc).toContain('<w:numId w:val="3"/>');
    expect(doc).toContain('<w:numId w:val="4"/>');
    expect(xml("word/numbering.xml")).toContain('<w:num w:numId="4">');
  });

  it("strips characters XML cannot represent", () => {
    const bytes = toDocx(createDoc("T", [paragraph("a\u0000b\u0008c")]));
    const doc = strFromU8(unzipSync(bytes)["word/document.xml"]!);
    expect(doc).toContain(">abc<");
  });
});
