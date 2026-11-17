// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DocumentSession, type Block, createDoc, heading, paragraph, plainText, toDocx, type DocxImportResult } from "@pli.dev/docs";
import { PliDocument } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const textOf = (block: Block): string => plainText((block as unknown as { runs: Parameters<typeof plainText>[0] }).runs);

describe("File > Import DOCX", () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const pick = async (file: File) => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"][aria-label="Import a DOCX file"]')!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
  };
  const docxFile = (name = "Report.docx") => {
    const bytes = toDocx(createDoc("Report", [heading(1, "Imported"), paragraph("From a file")]));
    const file = new File([bytes as BlobPart], name);
    // jsdom's File has no arrayBuffer in older versions.
    if (!file.arrayBuffer) (file as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return file;
  };

  it("is in the File menu and opens a file chooser", () => {
    const session = new DocumentSession(createDoc("T", [paragraph("x")]));
    act(() => root.render(<PliDocument session={session} />));
    const file = [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === "File")!;
    act(() => void file.click());
    const labels = [...host.querySelectorAll(".pli-menu-list .pli-menu-label")].map((l) => l.textContent);
    expect(labels).toContain("Import DOCX…");
    expect(host.querySelector<HTMLInputElement>('input[type="file"][aria-label="Import a DOCX file"]')!.accept).toContain(".docx");
  });

  it("replaces the document with the file, in one undo step", async () => {
    const session = new DocumentSession(createDoc("Old", [paragraph("old text")]));
    act(() => root.render(<PliDocument session={session} />));
    await pick(docxFile());
    expect(session.state.blocks.map((b) => textOf(b))).toEqual(["Imported", "From a file"]);
    session.undo();
    expect(session.state.blocks.map((b) => textOf(b))).toEqual(["old text"]);
  });

  it("tells the app what was read", async () => {
    const session = new DocumentSession(createDoc("Old", [paragraph("old")]));
    const results: DocxImportResult[] = [];
    act(() => root.render(<PliDocument session={session} onImported={(r) => results.push(r)} />));
    await pick(docxFile());
    expect(results).toHaveLength(1);
    expect(results[0]!.doc.blocks).toHaveLength(2);
  });

  it("shows a notice when the file can't be read, and leaves the document alone", async () => {
    const session = new DocumentSession(createDoc("Old", [paragraph("old")]));
    act(() => root.render(<PliDocument session={session} />));
    const bad = new File([new Uint8Array([1, 2, 3])], "bad.docx");
    (bad as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = async () => new Uint8Array([1, 2, 3]).buffer;
    await pick(bad);
    expect(host.querySelector(".pli-notice")?.textContent).toMatch(/bad\.docx.*zip/);
    expect(textOf(session.state.blocks[0]!)).toBe("old");
  });

  it("isn't offered on a document that can't be changed", () => {
    const session = new DocumentSession(createDoc("T", [paragraph("x")]));
    act(() => root.render(<PliDocument session={session} readOnly />));
    const file = [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === "File")!;
    act(() => void file.click());
    const item = [...host.querySelectorAll<HTMLButtonElement>(".pli-menu-list button")].find((b) => b.textContent?.includes("Import DOCX"))!;
    expect(item.disabled).toBe(true);
  });
});

describe("File > Download > PDF", () => {
  it("is offered, and says what is needed when the pages aren't there to read", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const session = new DocumentSession(createDoc("T", [paragraph("x")]));
    act(() => root.render(<PliDocument session={session} defaultView="continuous" />));
    const file = [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === "File")!;
    act(() => void file.click());
    const download = [...host.querySelectorAll<HTMLButtonElement>(".pli-menu-list button")].find((b) => b.textContent?.includes("Download"))!;
    act(() => void download.click());
    const labels = [...host.querySelectorAll(".pli-menu-list .pli-menu-label")].map((l) => l.textContent);
    expect(labels).toContain("PDF document (.pdf)");
    const { exportPdf } = await import("../src");
    await expect(exportPdf(host.querySelector<HTMLElement>(".pli-document")!)).rejects.toThrowError(/page view/);
    act(() => root.unmount());
    host.remove();
  });
});
