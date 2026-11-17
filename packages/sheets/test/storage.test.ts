import { StorageClient, encodeBase64, type StorageAdapter } from "@pli.dev/core";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, loadWorkbook, pictureSources, saveWorkbook, storageData, type Workbook } from "../src";

/** A 1x1 PNG. */
const PNG = `data:image/png;base64,${encodeBase64(Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)))}`;

function bucket() {
  const files = new Map<string, { bytes: Uint8Array; type: string }>();
  const uploads: string[] = [];
  const adapter: StorageAdapter = {
    async upload(file, info) {
      uploads.push(info.name);
      files.set(info.name, { bytes: new Uint8Array(await file.arrayBuffer()), type: info.type });
      return { ref: info.name };
    },
    resolve: (ref) => `https://files.test/${ref}`,
    read: async (ref) => {
      const f = files.get(ref)!;
      return { size: f.bytes.length, type: f.type, arrayBuffer: async () => f.bytes.slice().buffer as ArrayBuffer };
    },
  };
  return { files, uploads, client: new StorageClient(adapter) };
}

function book(blocks = true): Workbook {
  const s = new SheetSession(createWorkbook("B", ["Data"]));
  s.setCell("Data", "A1", "x");
  s.addImage("Data", { src: PNG, from: { row: 2, col: 2 }, width: 10, height: 10 });
  s.addImage("Data", { src: PNG, from: { row: 5, col: 2 }, width: 10, height: 10 });
  return { ...s.state, ...(blocks ? { dataBlocks: [{ source: "data:Sales", rows: [["Region", "Total"], ["East", 5], ["West", 7]], from: "host" as const }] } : {}) };
}

describe("workbooks in your file storage", () => {
  it("saves pictures once and data blocks apart, and loads everything back", async () => {
    const b = bucket();
    const wb = book();
    const saved = await saveWorkbook(wb, b.client, { name: "plans/q1.sheet.json" });
    expect(saved.failed).toEqual([]);
    expect(b.uploads.filter((u) => /picture/.test(u))).toHaveLength(1);
    expect(pictureSources(saved.workbook).size).toBe(1);
    expect([...pictureSources(saved.workbook)][0]).not.toMatch(/^data:/);
    expect(saved.workbook.dataBlocks![0]!.rows).toHaveLength(1);
    expect(Object.keys(saved.data)).toEqual(["data:Sales"]);
    const loaded = await loadWorkbook(saved.ref, b.client);
    expect(loaded.workbook.sheets[0]!.images!.map((i) => i.src)).toEqual([PNG, PNG]);
    expect(loaded.workbook.dataBlocks![0]!.rows).toHaveLength(3);
    expect(loaded.workbook.sheets[0]!.cells["A1"]?.v).toBe("x");
  });

  it("reads data blocks on demand for pivot tables", async () => {
    const b = bucket();
    const saved = await saveWorkbook(book(), b.client);
    const resolver = storageData(b.client, saved.data);
    expect(await resolver({ source: "data:Sales", kind: "data", name: "Sales" })).toMatchObject({ rows: [["Region", "Total"], ["East", 5], ["West", 7]] });
    expect(await resolver({ source: "data:Other", kind: "data", name: "Other" })).toBeNull();
  });

  it("keeps a picture that cannot be uploaded embedded, and says so; a missing file stops a load unless lenient", async () => {
    const b = bucket();
    const failing = new StorageClient({ upload: async (file, info) => { if (info.type.startsWith("image/")) throw new Error("quota"); return { ref: info.name }; }, resolve: (r) => r });
    const saved = await saveWorkbook(book(false), failing);
    expect(saved.failed).toHaveLength(1);
    expect(pictureSources(saved.workbook).has(PNG)).toBe(true);
    const ok = await saveWorkbook(book(false), b.client, { name: "a.sheet.json" });
    for (const key of [...b.files.keys()]) if (/picture/.test(key)) b.files.delete(key);
    await expect(loadWorkbook(ok.ref, b.client)).rejects.toThrow();
    const lenient = await loadWorkbook(ok.ref, b.client, { lenient: true });
    expect(lenient.failed).toHaveLength(1);
    expect(lenient.workbook.sheets[0]!.images ?? []).toHaveLength(0);
  });
});
