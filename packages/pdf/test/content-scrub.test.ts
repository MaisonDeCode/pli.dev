import { describe, expect, it } from "vitest";
import { openPdf } from "../src";
import { PdfFile } from "../src/cos/file";
import { extractText } from "../src/text";
import { makePdf } from "./support/content";
import { obj, streamObj } from "./support/handmade";
import { contains } from "./support/leak";

const spec = () =>
  makePdf({
    content: "BT /F1 12 Tf 20 100 Td (Plain page text) Tj ET",
    catalog: "/Metadata 30 0 R /Names << /EmbeddedFiles << /Names [(a.txt) 31 0 R] >> /JavaScript << /Names [(js) 32 0 R] >> >> /OpenAction << /S /JavaScript /JS (app.alert\\(SCRIPTSECRET\\)) >>",
    pageExtra: "/Annots [33 0 R] /PieceInfo << /App << /Private (PIECESECRET) >> >>",
    objs: [
      streamObj(30, "/Type /Metadata /Subtype /XML", "<x:xmpmeta><dc:creator>XMPSECRET</dc:creator></x:xmpmeta>"),
      obj(31, "<< /Type /Filespec /F (a.txt) /EF << /F 34 0 R >> >>"),
      obj(32, "<< /S /JavaScript /JS (JSSECRET) >>"),
      obj(33, "<< /Type /Annot /Subtype /FileAttachment /Rect [10 10 30 30] /Contents (ATTACHNOTE) /FS 31 0 R >>"),
      streamObj(34, "/Type /EmbeddedFile", "ATTACHEDSECRET file content"),
      obj(35, "<< /Title (Quarterly TITLESECRET) /Author (AUTHORSECRET) /Producer (a tool) >>"),
    ],
  });

describe("scrubbing metadata", () => {
  it("takes information, XMP, attachments, scripts and private data out of a new file", async () => {
    const bytes = spec();
    // the Info dictionary is object 35: point the trailer at it
    const withInfo = new TextDecoder("latin1").decode(bytes).replace("/Root 1 0 R", "/Root 1 0 R /Info 35 0 R");
    const s = await openPdf(Uint8Array.from(withInfo, (c) => c.charCodeAt(0)));
    expect(s.doc.meta.author).toBe("AUTHORSECRET");
    for (const word of ["XMPSECRET", "ATTACHEDSECRET", "JSSECRET", "SCRIPTSECRET", "PIECESECRET", "AUTHORSECRET"]) expect(contains(await s.save({ mode: "rewrite" }), word), `${word} before`).toBe(true);
    const saved = await s.content.scrubMetadata();
    expect(saved.mode).toBe("rewrite");
    for (const word of ["XMPSECRET", "ATTACHEDSECRET", "JSSECRET", "SCRIPTSECRET", "PIECESECRET", "AUTHORSECRET", "TITLESECRET", "ATTACHNOTE"]) expect(contains(saved.bytes, word), word).toBe(false);
    const f = PdfFile.open(saved.bytes);
    expect(f.catalog().has("Metadata")).toBe(false);
    expect(extractText(f, 0).text).toBe("Plain page text");
  });

  it("warns when redacted text also appears in the title, bookmarks or fields", async () => {
    const bytes = makePdf({ content: "BT /F1 12 Tf 20 100 Td (Project NIGHTJAR budget) Tj ET" });
    const s = await openPdf(bytes);
    s.core.transact([{ type: "set_meta", patch: { title: "NIGHTJAR plan" } }]);
    s.core.transact([{ type: "set_outline", items: [{ id: "o1", title: "About NIGHTJAR", children: [] }] }]);
    await s.content.markSearch("NIGHTJAR");
    s.content.applyRedactions();
    const saved = await s.saveDetailed();
    expect(saved.warnings.join(" ")).toMatch(/also appears in the document information \(title, author\.\.\.\), the bookmarks/);
    expect(extractText(PdfFile.open(saved.bytes), 0).text).not.toContain("NIGHTJAR");
  });
});
