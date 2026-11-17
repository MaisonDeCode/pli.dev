import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import { createFonts, noFontEnv, type FontSource } from "@pli.dev/core";
import { createDoc, fromDocx, heading, htmlToFragment, paragraph, parseTrueType, rtfToBlocks, table, text, toDocx, toHtml, toPdf, usedFonts, type Doc, type PdfPage } from "../src";

const here = dirname(fileURLToPath(import.meta.url));
const lora = new Uint8Array(readFileSync(join(here, "../../core/test/fixtures/fonts/lora-latin-400-normal.ttf")));

const parts = (bytes: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));
const parts_ = parts;
const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
const parse = (xml: string) => {
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (_l, m) => void errors.push(m) }).parseFromString(xml, "text/xml");
  expect(errors).toEqual([]);
  return doc;
};
const runFonts = (doc: Doc) => doc.blocks.flatMap((b) => ("runs" in b ? b.runs.map((r) => r.marks?.fontFamily) : []));

function sample(): Doc {
  return createDoc("Fonts", [
    heading(1, [text("Title", { fontFamily: "Lora" })]),
    paragraph([text("mono ", { fontFamily: "Roboto Mono" }), text("calibri ", { fontFamily: "Calibri" }), text("comic", { fontFamily: "Comic Sans MS" }), text(" a&b <c> \"q\"", { fontFamily: 'Odd & "Name" <x>' })]),
  ]);
}

describe("usedFonts", () => {
  it("lists each family named anywhere, once, in document order", () => {
    const doc: Doc = {
      ...createDoc("x", [
        paragraph([text("a", { fontFamily: "Lora" }), text("b"), text("c", { fontFamily: "Roboto Mono" }), text("d", { fontFamily: "Lora" })]),
        table([[[text("cell", { fontFamily: "Calibri" })], "plain"]]),
        { id: "sb", type: "section_break", kind: "next_page", regions: { header: [paragraph([text("h", { fontFamily: "Section Header Font" })])] } },
      ]),
      header: [paragraph([text("h", { fontFamily: "Header Font" })])],
      footer: [paragraph([text("f", { fontFamily: "  Lora " })])],
      footnotes: { n1: [paragraph([text("n", { fontFamily: "Note Font" })])] },
      styles: { s1: { name: "S", kind: "paragraph", marks: { fontFamily: "Style Font" } }, s2: { name: "T", kind: "character", marks: { bold: true } } },
    };
    expect(usedFonts(doc)).toEqual(["Lora", "Roboto Mono", "Calibri", "Section Header Font", "Header Font", "Note Font", "Style Font"]);
  });

  it("names no default fonts and handles an empty document", () => {
    expect(usedFonts(createDoc("x", [paragraph("plain"), { id: "c", type: "code_block", runs: [{ text: "x", marks: { code: true } }] }]))).toEqual([]);
    expect(usedFonts(createDoc("x"))).toEqual([]);
  });
});

describe("toDocx: fonts", () => {
  const docx = (options?: Parameters<typeof toDocx>[1]) => toDocx(sample(), options);

  it("writes fontTable.xml, related from the document and listed in the content types, well-formed", () => {
    const files = parts(docx());
    for (const xml of Object.values(files)) parse(xml);
    expect(files["word/_rels/document.xml.rels"]).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"');
    expect(files["[Content_Types].xml"]).toContain('PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"');
  });

  it("lists every family with a stand-in, the family kind and the pitch, in the schema's order", () => {
    const table = parse(parts(docx())["word/fontTable.xml"]!);
    const fonts = new Map<string, import("@xmldom/xmldom").Element>();
    for (const font of Array.from(table.getElementsByTagName("w:font"))) fonts.set(font.getAttribute("w:name")!, font);
    expect([...fonts.keys()]).toEqual(expect.arrayContaining(["Arial", "Courier New", "Lora", "Roboto Mono", "Calibri", "Comic Sans MS", 'Odd & "Name" <x>']));
    const kids = (name: string) => Array.from(fonts.get(name)!.childNodes).filter((c) => c.nodeType === 1).map((c) => `${(c as unknown as { tagName: string }).tagName}=${(c as unknown as { getAttribute(n: string): string }).getAttribute("w:val")}`);
    expect(kids("Lora")).toEqual(["w:altName=Georgia", "w:family=roman", "w:pitch=variable"]);
    expect(kids("Roboto Mono")).toEqual(["w:altName=Consolas", "w:family=modern", "w:pitch=fixed"]);
    // Office's own fonts need no stand-in.
    expect(kids("Calibri")).toEqual(["w:family=swiss", "w:pitch=variable"]);
    expect(kids("Comic Sans MS")[0]).toBe("w:family=script");
    expect(kids("Courier New")).toEqual(["w:family=modern", "w:pitch=fixed"]);
    expect(kids('Odd & "Name" <x>')[0]).toBe("w:altName=Arial");
  });

  it("keeps names as written through a round trip, odd characters included", () => {
    const back = fromDocx(docx()).doc;
    expect(runFonts(back).filter(Boolean)).toEqual(["Lora", "Roboto Mono", "Calibri", "Comic Sans MS", 'Odd & "Name" <x>']);
  });

  it('with fonts: "office" writes the nearest Office font in the runs and the table', () => {
    const files = parts(docx({ fonts: "office" }));
    for (const xml of Object.values(files)) parse(xml);
    const back = fromDocx(docx({ fonts: "office" })).doc;
    expect(runFonts(back).filter(Boolean)).toEqual(["Georgia", "Consolas", "Calibri", "Comic Sans MS", "Arial"]);
    const names = Array.from(parse(files["word/fontTable.xml"]!).getElementsByTagName("w:font")).map((f) => f.getAttribute("w:name"));
    expect(names).toEqual(expect.arrayContaining(["Georgia", "Consolas", "Calibri", "Comic Sans MS", "Arial"]));
    expect(names).not.toContain("Lora");
    expect(files["word/document.xml"]).not.toContain("Lora");
    expect(files["word/fontTable.xml"]).not.toContain("altName");
  });

  it("names the fonts of styles, headers and footnotes in the table too", () => {
    const doc: Doc = {
      ...createDoc("x", [paragraph("body")]),
      header: [paragraph([text("h", { fontFamily: "Playfair Display" })])],
      styles: { s: { name: "Fancy", kind: "character", marks: { fontFamily: "Dancing Script" } } },
    };
    const xml = parts(toDocx(doc))["word/fontTable.xml"]!;
    expect(xml).toContain('w:name="Playfair Display"');
    expect(xml).toContain('<w:font w:name="Dancing Script"><w:altName w:val="Segoe Script"/><w:family w:val="script"/>');
  });
});

describe("fromDocx: font references", () => {
  /** A file built by hand: the body's runs and an optional theme. */
  function make(runs: string, theme?: string): Uint8Array {
    const rels = '<Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>';
    const parts = parts_(toDocx(createDoc("x", [paragraph("seed")])));
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    parts["word/document.xml"] = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body><w:p>${runs}</w:p></w:body></w:document>`;
    if (theme) {
      parts["word/theme/theme1.xml"] = theme;
      parts["word/_rels/document.xml.rels"] = parts["word/_rels/document.xml.rels"]!.replace("</Relationships>", `${rels}</Relationships>`);
    }
    return zip(parts);
  }
  const theme = (major: string, minor: string) =>
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="x"><a:majorFont><a:latin typeface="${major}"/><a:ea typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${minor}"/><a:ea typeface=""/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
  const run = (fonts: string, t = "t") => `<w:r><w:rPr><w:rFonts ${fonts}/></w:rPr><w:t>${t}</w:t></w:r>`;
  const fontsOf = (bytes: Uint8Array) => runFonts(fromDocx(bytes).doc);

  it("resolves theme font references through the theme's font scheme, which win over a name beside them", () => {
    const bytes = make(run('w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"', "a") + run('w:asciiTheme="majorHAnsi"', "b") + run('w:ascii="Georgia" w:asciiTheme="minorHAnsi"', "c"), theme("Lora", "Open Sans"));
    expect(fontsOf(bytes)).toEqual(["Open Sans", "Lora", "Open Sans"]);
  });

  it("leaves the font unset for a theme reference it can't resolve, and uses the written name when there is one", () => {
    expect(fontsOf(make(run('w:asciiTheme="minorHAnsi"')))).toEqual([undefined]);
    expect(fontsOf(make(run('w:asciiTheme="minorBidi"'), theme("A", "B")))).toEqual([undefined]);
    expect(fontsOf(make(run('w:ascii="Georgia" w:asciiTheme="minorHAnsi"')))).toEqual(["Georgia"]);
  });

  it("ignores a font that is only for East Asian or complex-script text, and prefers the Latin name", () => {
    expect(fontsOf(make(run('w:eastAsia="MS Mincho"')))).toEqual([undefined]);
    expect(fontsOf(make(run('w:cs="Arial Unicode MS"')))).toEqual([undefined]);
    expect(fontsOf(make(run('w:ascii="Lora" w:eastAsia="MS Mincho" w:cs="Tahoma"') + run('w:hAnsi="Calibri" w:cs="Tahoma"')))).toEqual(["Lora", "Calibri"]);
  });

  it("keeps names as the file wrote them, even a PostScript alias", () => {
    expect(fontsOf(make(run('w:ascii="ArialMT" w:hAnsi="ArialMT"')))).toEqual(["ArialMT"]);
  });
});

describe("HTML and RTF fonts", () => {
  const htmlFonts = (css: string) => {
    const f = htmlToFragment(`<p><span style="${css}">x</span></p>`);
    return f.blocks.flatMap((b) => ("runs" in b ? b.runs.map((r) => r.marks?.fontFamily) : []));
  };

  it("imports the first family of a CSS list, unquoted", () => {
    expect(htmlFonts("font-family:&quot;Lora&quot;, Georgia, serif")).toEqual(["Lora"]);
    expect(htmlFonts("font-family:'Roboto Mono',monospace")).toEqual(["Roboto Mono"]);
    expect(htmlFonts("font-family: lora !important")).toEqual(["Lora"]);
    expect(htmlFonts("font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif")).toEqual(["Segoe UI"]);
    expect(htmlFonts("font:italic 12pt/1.4 'Lora', serif")).toEqual(["Lora"]);
  });

  it("stores no family for generic names alone", () => {
    for (const generic of ["sans-serif", "serif", "monospace", "system-ui", "cursive, fantasy", "ui-monospace, monospace"]) {
      expect(htmlFonts(`font-family:${generic}`), generic).toEqual([undefined]);
    }
  });

  it("exports the family with its fallbacks, which import reads back as the family", () => {
    const html = toHtml(sample());
    expect(html).toContain("font-family:Lora, serif");
    expect(html).toContain("font-family:Calibri, Carlito");
    expect(html).toContain("font-family:'Roboto Mono'");
    const back = htmlToFragment(html).blocks.flatMap((b) => ("runs" in b ? b.runs.map((r) => r.marks?.fontFamily) : []));
    expect(back.filter(Boolean).slice(0, 4)).toEqual(["Lora", "Roboto Mono", "Calibri", "Comic Sans MS"]);
  });

  it("tidies PostScript names in RTF with the catalogue's help", () => {
    const rtf = "{\\rtf1{\\fonttbl{\\f0 ArialMT;}{\\f1 OpenSans;}{\\f2 Lora;}}\\f0 a\\f1 b\\f2 c}";
    const runs = rtfToBlocks(rtf).flatMap((b) => ("runs" in b ? b.runs.map((r) => r.marks?.fontFamily) : []));
    expect(runs).toEqual(["Arial", "Open Sans", "Lora"]);
  });
});

// ---- PDF ---------------------------------------------------------------------------------------------------------

function pdfText(bytes: Uint8Array) {
  return strFromU8(bytes, true);
}
const pg = (items: PdfPage["items"]): PdfPage => ({ width: 612, height: 792, items });
const word = (family: string, t = "Hello", extra: object = {}) => ({ type: "text" as const, x: 10, y: 20, text: t, font: { family, ...extra }, size: 12 });

describe("toPdf: fonts from a registry", () => {
  const source: FontSource = {
    name: "test",
    faces: () => [],
    file: async (family, wanted) => (family.family === "Lora" && wanted.weight === 400 && wanted.style === "normal" ? lora : null),
  };

  it("embeds a font the registry hands over, with its ToUnicode map and no warnings", async () => {
    const registry = createFonts({ env: noFontEnv, storage: null, source });
    const { fonts, warnings: fetchWarnings } = await registry.pdfFonts(usedFonts(sample()).filter((n) => n === "Lora"));
    expect(fetchWarnings).toEqual([]);
    expect(Object.keys(fonts)).toEqual(["Lora"]);
    const warnings: string[] = [];
    const pdf = toPdf([pg([word("Lora", "Hello"), word("Calibri", "Hello")])], { fonts, warnings, compress: false });
    expect(warnings).toEqual([]);
    const src = pdfText(pdf);
    expect(src).toContain("/FontFile2");
    expect(src).toContain("/Subtype /CIDFontType2");
    expect(src).toContain("beginbfchar");
    expect(src).not.toContain("couldn't be embedded");
    // Calibri has no file: it is drawn in Helvetica.
    expect(src).toContain("/BaseFont /Helvetica ");
  });

  it("falls back to the standard font of the family's kind when it isn't embedded", () => {
    const cases: [string, string][] = [["Lora", "Times-Roman"], ["Roboto Mono", "Courier"], ["Roboto", "Helvetica"], ["Merriweather", "Times-Roman"], ["Calibri", "Helvetica"], ["Georgia", "Times-Roman"], ["Some Unknown Font", "Helvetica"], ["Dancing Script", "Helvetica"]];
    for (const [family, std] of cases) expect(pdfText(toPdf([pg([word(family)])])), family).toContain(`/BaseFont /${std} `);
    expect(pdfText(toPdf([pg([word("Lora", "x", { bold: true, italic: true })])]))).toContain("/BaseFont /Times-BoldItalic ");
    expect(pdfText(toPdf([pg([word('"Lora", serif')])]))).toContain("/BaseFont /Times-Roman ");
  });

  it("draws characters the embedded font lacks in a standard font, once-warned, and as ? when none has them", () => {
    expect(parseTrueType(lora).glyphFor(0x192)).toBe(0);
    const warnings: string[] = [];
    // Latin-only subset: the florin sign has a place in the standard font, Cyrillic and CJK don't.
    const pdf = toPdf([pg([word("Lora", "AƒЖb中"), word("Lora", "again Ж中")])], { fonts: { Lora: lora }, warnings, compress: false });
    expect(warnings).toHaveLength(2);
    expect(warnings.join(" ")).toMatch(/not in the font that was given.*ƒ/);
    expect(warnings.join(" ")).toMatch(/no place in the fonts.*Ж/);
    expect(warnings.filter((w) => /no place/.test(w))).toHaveLength(1);
    const content = pdfText(pdf);
    // The florin (0x83) and the question marks come out in the standard font, the Latin letters in Lora.
    expect(content).toContain("<833F> Tj"); // ƒ and Ж, side by side
    expect(content).toContain("<3F> Tj"); // 中, after the b
    expect(content).toContain("<3F3F> Tj");
    expect(pdfText(pdf)).toContain("/FontFile2");
    expect(pdfText(pdf)).toContain("/BaseFont /Times-Roman ");
  });
});
