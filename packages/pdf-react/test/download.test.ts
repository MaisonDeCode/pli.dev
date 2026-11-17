import { describe, expect, it } from "vitest";
import { unzipSync } from "../../pdf/node_modules/fflate";
import { claimKey, crc32, formShortcutTable, viewerShortcutTable, documentName, downloadFiles, fileStem, makeZip, pageShortcutTable, readZip, registerShortcuts, safeName, shortcutGroups } from "../src";
import { rangeText, sniffFile } from "../src";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("makes archives an independent reader opens, with names and bytes intact", () => {
    const files = [
      { name: "a.pdf", data: bytes("%PDF-1.7 first") },
      { name: "ünï/cøde.pdf", data: new Uint8Array(1000).map((_, i) => i % 251) },
      { name: "a.pdf", data: bytes("same name") },
      { name: "empty.txt", data: new Uint8Array() },
    ];
    const zip = makeZip(files, new Date(2026, 10, 16, 12, 30, 10));
    const out = unzipSync(zip);
    expect(Object.keys(out)).toEqual(["a.pdf", "ünï-cøde.pdf", "a-2.pdf", "empty.txt"]);
    expect(out["a.pdf"]).toEqual(files[0]!.data);
    expect(out["ünï-cøde.pdf"]).toEqual(files[1]!.data);
    expect(out["a-2.pdf"]).toEqual(bytes("same name"));
    expect(out["empty.txt"]!.length).toBe(0);
    expect(readZip(zip).map((f) => f.name)).toEqual(Object.keys(out));
  });

  it("downloads one file as it is, several as a ZIP, or one after the other", async () => {
    const sent: [string, string, number][] = [];
    const download = (b: Uint8Array, name: string, mime: string) => void sent.push([name, mime, b.length]);
    const files = [
      { name: "x-1.pdf", data: bytes("one") },
      { name: "x-2.pdf", data: bytes("two") },
    ];
    expect(await downloadFiles([files[0]!], { download })).toEqual(["x-1.pdf"]);
    expect(await downloadFiles(files, { download, zipName: "x.zip" })).toEqual(["x.zip"]);
    expect(sent[1]![0]).toBe("x.zip");
    expect(sent[1]![1]).toBe("application/zip");
    expect(await downloadFiles(files, { download, zip: false })).toEqual(["x-1.pdf", "x-2.pdf"]);
    expect(await downloadFiles([], { download })).toEqual([]);
  });
});

describe("names", () => {
  it("makes names safe and finds the stem", () => {
    expect(safeName('a/b\\c:d*e?f"g<h>i|j.pdf')).toBe("a-b-c-d-e-f-g-h-i-j.pdf");
    expect(safeName("..hidden")).toBe("hidden");
    expect(safeName("   ")).toBe("document");
    expect(fileStem("report.final.pdf")).toBe("report.final");
    expect(fileStem("noext")).toBe("noext");
    expect(documentName({ sources: [{ id: "main", name: "from-source.pdf" }] })).toBe("from-source.pdf");
    expect(documentName({ name: "given.pdf", sources: [] })).toBe("given.pdf");
    expect(documentName({ sources: [] })).toBe("document.pdf");
  });

  it("writes page positions as ranges", () => {
    expect(rangeText([0, 1, 2, 4, 6, 7])).toBe("1-3, 5, 7-8");
    expect(rangeText([3, 1, 2], "_")).toBe("2-4");
    expect(rangeText([])).toBe("");
  });

  it("tells PDFs from pictures from anything else", () => {
    expect(sniffFile(bytes("%PDF-1.7\n"))).toBe("pdf");
    expect(sniffFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image");
    expect(sniffFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image");
    expect(sniffFile(bytes("hello"))).toBeNull();
    // a few bytes of junk before the header are allowed, as readers do
    expect(sniffFile(bytes("\n\n  %PDF-1.4"))).toBe("pdf");
  });
});

describe("shortcuts", () => {
  it("lists the page shortcuts with no key listed twice", () => {
    const table = pageShortcutTable();
    expect(table.length).toBeGreaterThan(15);
    for (const row of table) {
      expect(row.keys).not.toBe("");
      expect(row.action).not.toBe("");
    }
    expect(new Set(table.map((r) => r.keys)).size).toBe(table.length);
    expect(shortcutGroups().find((g) => g.group === "Pages and files")!.rows).toEqual(table);
  });

  it("lists the viewer, page, form, annotation and edit keys as groups", () => {
    const groups = shortcutGroups().map((g) => g.group);
    expect(groups).toEqual(["Viewer", "Pages and files", "Forms", "Annotations", "Edit text and pictures"]);
    expect(viewerShortcutTable().length).toBeGreaterThan(5);
    expect(formShortcutTable().length).toBeGreaterThan(5);
  });

  it("lets other stages add their group, and gives a key to the first to claim it", () => {
    const off = registerShortcuts("Test group", () => [{ keys: "Q", action: "Quit" }]);
    expect(shortcutGroups().map((g) => g.group)).toContain("Test group");
    off();
    expect(shortcutGroups().map((g) => g.group)).not.toContain("Test group");
    const e = new Event("keydown");
    expect(claimKey(e)).toBe(true);
    expect(claimKey(e)).toBe(false);
    expect(claimKey({ nativeEvent: e })).toBe(false);
  });
});
