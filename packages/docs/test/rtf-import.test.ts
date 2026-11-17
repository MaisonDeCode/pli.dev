import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listLabels, readPaste, rtfToBlocks, type Block } from "../src";

const here = dirname(fileURLToPath(import.meta.url));
const text = (b: Block) => ("runs" in b ? b.runs.map((r) => r.text).join("") : "");
const runs = (b: Block) => ("runs" in b ? b.runs : []);

describe("RTF from a real Pages copy", () => {
  const rtf = readFileSync(resolve(here, "fixtures/clipboard/pages-text/text.rtf"), "utf8");
  const blocks = rtfToBlocks(rtf);

  it("reads the heading line, the bullets and the body text, with the blank lines Pages kept", () => {
    expect(blocks.map(text)).toEqual(["Heading Testing", "", "One", "Two ", "Three", "", "Testing some body text here."]);
  });

  it("makes the bullets a real list, and keeps the heading's bold and size", () => {
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "list_item", "list_item", "list_item", "paragraph", "paragraph"]);
    expect(listLabels(blocks).map((l) => l?.text)).toEqual([undefined, undefined, "•", "•", "•", undefined, undefined]);
    expect(runs(blocks[0]!)[0]).toMatchObject({ text: "Heading Testing", marks: { bold: true, fontSize: 16, fontFamily: "Helvetica Neue" } });
    expect(runs(blocks[6]!)[0]!.marks).not.toHaveProperty("bold");
  });

  it("is what is pasted when the browser gives RTF and plain text but no HTML, and HTML still wins when there is some", () => {
    const content = readPaste({ rtf, text: "Heading" });
    expect(content?.source).toBe("html");
    const withHtml = readPaste({ rtf, html: "<p>from html</p>", text: "x" });
    expect(withHtml && "blocks" in withHtml ? withHtml.blocks.map(text) : []).toEqual(["from html"]);
  });
});

describe("reading RTF", () => {
  const doc = (body: string, head = "") => `{\\rtf1\\ansi${head}\n${body}}`;

  it("reads bold, italic, underline, strike and ends them where the RTF does", () => {
    const [p] = rtfToBlocks(doc("\\b one\\b0  \\i two\\i0  \\ul three\\ulnone  \\strike four\\strike0  five"));
    expect(runs(p!).map((r) => [r.text, Object.keys(r.marks ?? {}).join()])).toEqual([["one", "bold"], [" ", ""], ["two", "italic"], [" ", ""], ["three", "underline"], [" ", ""], ["four", "strike"], [" five", ""]].map(([t, m]) => [t, m]));
  });

  it("reads size, colour and font from the tables, and leaves out black and the default size", () => {
    const head = "{\\fonttbl{\\f0 Arial;}{\\f1 Georgia;}}{\\colortbl;\\red255\\green0\\blue0;\\red0\\green0\\blue0;}";
    const [p] = rtfToBlocks(doc("\\f1\\fs32\\cf1 red \\fs22\\cf2 plain", head));
    expect(runs(p!)).toEqual([
      { text: "red ", marks: { fontSize: 16, color: "#ff0000", fontFamily: "Georgia" } },
      { text: "plain", marks: { fontFamily: "Georgia" } },
    ]);
  });

  it("reads escaped and Unicode characters, and line breaks", () => {
    const [p] = rtfToBlocks(doc("caf\\'e9 \\u8364? \\u233? \\{x\\} a\\line b\\tab c"));
    expect(text(p!)).toBe("café € é {x} a\nb\tc");
  });

  it("starts a paragraph at each \\par and keeps alignment until \\pard", () => {
    const blocks = rtfToBlocks(doc("\\pard\\qc one\\par two\\par\\pard three"));
    expect(blocks.map((b) => [text(b), (b as { align?: string }).align])).toEqual([["one", "center"], ["two", "center"], ["three", undefined]]);
  });

  it("reads a numbered list from the labels its items carry", () => {
    const item = (label: string, word: string) => `\\pard\\ls1\\ilvl0{\\listtext ${label}\\tab}${word}\\par\n`;
    const blocks = rtfToBlocks(doc(item("3.", "c") + item("4.", "d") + item("(a)", "e")));
    expect(listLabels(blocks).map((l) => l?.text)).toEqual(["3.", "4.", "a."]);
  });

  it("leaves out destinations it doesn't read, such as pictures and hidden extensions", () => {
    const blocks = rtfToBlocks(doc("shown{\\*\\generator Hidden;}{\\pict\\jpegblip ffd8ffe0}{\\info{\\title Secret}} text"));
    expect(blocks.map(text)).toEqual(["shown text"]);
  });

  it("gives nothing for what isn't RTF, and never throws on damaged or deeply nested input", () => {
    expect(rtfToBlocks("just some words")).toEqual([]);
    expect(rtfToBlocks("")).toEqual([]);
    expect(() => rtfToBlocks("{\\rtf1 " + "{".repeat(5000) + "x")).not.toThrow();
    expect(() => rtfToBlocks("{\\rtf1 \\u\\'zz\\ \\")).not.toThrow();
    expect(() => rtfToBlocks("{\\rtf1 " + "\\b ".repeat(200_000))).not.toThrow();
  });
});
