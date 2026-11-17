import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openPdf, PdfFile } from "../src";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe("saving an encrypted file", () => {
  it("keeps an update encrypted, and says when a new file is not", async () => {
    const session = await openPdf(fixture("enc-aes-128.pdf"));
    session.annots.addNote(session.doc.pages[0]!.id, 10, 10, "hello");

    const update = await session.saveDetailed();
    expect(update.mode).toBe("incremental");
    expect(PdfFile.open(update.bytes).encrypted).toBe(true);
    expect(update.warnings).toEqual([]);

    const copy = await session.saveDetailed({ mode: "rewrite" });
    expect(copy.mode).toBe("rewrite");
    expect(PdfFile.open(copy.bytes).encrypted).toBe(false);
    expect(copy.warnings).toEqual(["The original file is encrypted: the saved file is a new, unencrypted copy."]);
  });
});
