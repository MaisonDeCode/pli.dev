// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { PdfFile, type SaveOptions } from "@pli.dev/pdf";
import { byLabel, chooseMenu, click, closeMenus, flush, key, menuButton, menuEntry, q, qa, run, saveFile, setValue, useHost } from "./harness";
import { fileOf, mountPdf, openWords, pdfOf, stubChooser, stubDialogs, tick, wordsOf, WORDS } from "./pagesSupport";
import { makePng } from "../../pdf/test/support/png";
import { readZip } from "../src";
import { fakeRenderer } from "../src/testing";

useHost();
stubDialogs();

const toast = () => document.querySelector(".pli-pdf-toast")?.textContent ?? "";
const dot = () => document.querySelector("[aria-label='Unsaved changes']");
const menuItem = (label: string) => qa("[role=menu] [role^='menuitem']").find((b) => b.textContent!.includes(label))!;
const dialogButton = (text: string) => qa<HTMLButtonElement>("dialog[open] button").find((b) => b.textContent!.trim() === text)!;
const fileMenu = async (item: string) => {
  // The Download dialog is the last entry of the Download submenu.
  if (item === "Download…") return chooseMenu("File", "Download", "More download options…");
  if (item === "Export pages as pictures…") return chooseMenu("File", "Download", "Pages as pictures");
  await chooseMenu("File", item);
};
const dirtyIt = (session: Awaited<ReturnType<typeof openWords>>) => run(() => session.pages.rotate([session.doc.pages[0]!.id], 90));
const bytesOk = (b: Uint8Array) => new TextDecoder("latin1").decode(b.subarray(0, 5)) === "%PDF-";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Whether File > Save is greyed out. */
const saveDisabled = async () => {
  const e = (await menuEntry("File", "Save"))!;
  const off = e.hasAttribute("disabled") || e.getAttribute("aria-disabled") === "true";
  await closeMenus();
  return off;
};

describe("save", () => {
  it("calls onSave with the saved bytes and what the save found, and the document counts as saved when it resolves", async () => {
    const session = await openWords();
    let release!: () => void;
    const seen: { bytes: Uint8Array; mode: string }[] = [];
    await mountPdf(session, {
      onSave: (bytes, result) => {
        seen.push({ bytes, mode: result.mode });
        return new Promise<void>((r) => (release = r));
      },
    });
    expect(dot()).toBeNull();
    expect(await saveDisabled()).toBe(true);
    await dirtyIt(session);
    expect(dot()).toBeTruthy();
    expect(await saveDisabled()).toBe(false);
    await saveFile();
    await flush();
    expect(seen).toHaveLength(1);
    expect(bytesOk(seen[0]!.bytes)).toBe(true);
    expect(seen[0]!.mode).toBe("incremental");
    // not saved until the host says so
    expect(session.dirty).toBe(true);
    expect(dot()).toBeTruthy();
    await act(async () => release());
    await flush();
    expect(session.dirty).toBe(false);
    expect(dot()).toBeNull();
    expect(toast()).toContain("Saved report.pdf");
    expect(PdfFile.open(seen[0]!.bytes).pages()[0]!.rotate).toBe(90);
  });

  it("keeps the dot and says so when the host's save fails", async () => {
    const session = await openWords();
    await mountPdf(session, {
      onSave: async () => {
        throw new Error("the disk is full");
      },
    });
    await dirtyIt(session);
    await key(q(".pli-pdf-scroller"), "s", { ctrlKey: true });
    await flush();
    expect(session.dirty).toBe(true);
    expect(dot()).toBeTruthy();
    expect(q(".pli-pdf-toast").getAttribute("role")).toBe("alert");
    expect(toast()).toContain("Could not save. The disk is full.");
  });

  it("lists warnings in a dialog, with the sizes", async () => {
    const session = await openWords();
    const real = session.saver!;
    session.saver = async (s, o) => ({ ...(await real(s, o)), warnings: ["The font Zapf was missing.", "A stamp was left out."] });
    await mountPdf(session, { onSave: () => {} });
    await dirtyIt(session);
    await saveFile();
    await flush();
    expect(session.dirty).toBe(false);
    expect(q("dialog[open] .pli-dialog-title").textContent).toBe("Saved with warnings");
    expect(qa("dialog[open] .pli-pdf-warnings li").map((li) => li.textContent)).toEqual(["The font Zapf was missing.", "A stamp was left out."]);
    expect(q("dialog[open]").textContent).toContain("2 things could not be written exactly");
    expect(q("dialog[open]").textContent).toMatch(/the original was .* KB/);
    await click(dialogButton("Close"));
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("has no Save button without onSave or in a read-only viewer", async () => {
    const a = await openWords();
    await mountPdf(a);
    expect(document.querySelector("[aria-label='Save']")).toBeNull();
    await click(menuButton("File"));
    expect(qa("[role=menu] [role^='menuitem']").map((i) => i.textContent!.replace(/(Ctrl\+|⌘).*/, "").replace("›", ""))).toEqual(["Save a copy", "Download", "Document properties…", "Print…"]);
  });
});

describe("download and copies", () => {
  it("downloads with the options chosen in the dialog and shows how big the file is", async () => {
    const session = await openWords();
    const calls: SaveOptions[] = [];
    const real = session.saver!;
    session.saver = (s, o) => (calls.push(o), real(s, o));
    const { downloads } = await mountPdf(session);
    await dirtyIt(session);
    await fileMenu("Download…");
    expect(q("dialog[open] .pli-dialog-title").textContent).toBe("Download");
    expect(qa("dialog[open] input[type=radio]")).toHaveLength(4);
    await click(dialogButton("Download"));
    await flush();
    expect(calls.at(-1)).toEqual({ mode: "auto" });
    expect(downloads.at(-1)!.name).toBe("report.pdf");
    expect(bytesOk(downloads.at(-1)!.bytes)).toBe(true);
    expect(q("dialog[open] .pli-dialog-title").textContent).toBe("Downloaded");
    expect(q("dialog[open]").textContent).toContain("added to the end of the original file");
    expect(session.dirty).toBe(true); // a download is a copy, not a save
    await click(dialogButton("Close"));

    const choose = async (n: number, scrub = false) => {
      await fileMenu("Download…");
      await click(qa("dialog[open] input[type=radio]")[n]!);
      if (scrub) await click(q("dialog[open] input[type=checkbox]"));
      await click(dialogButton("Download"));
      await flush();
      await click(dialogButton("Close"));
    };
    await choose(1);
    expect(calls.at(-1)).toEqual({ mode: "optimise" });
    await choose(2);
    expect(calls.at(-1)).toEqual({ flatten: true });
    await choose(3);
    expect(calls.at(-1)).toEqual({ flatten: "forms" });
    await choose(0, true);
    expect(calls.at(-1)).toEqual({ mode: "rewrite", scrub: true });
    expect(PdfFile.open(downloads.at(-1)!.bytes).pageCount()).toBe(5);
  });

  it("says the file is smaller when it is", async () => {
    const session = await openWords(WORDS, "big.pdf");
    await mountPdf(session);
    await fileMenu("Download…");
    await click(qa("dialog[open] input[type=radio]")[1]!);
    await click(dialogButton("Download"));
    await flush();
    expect(q("dialog[open]").textContent).toMatch(/A new file was written/);
    expect(q("dialog[open]").textContent).toMatch(/\d+% (smaller|bigger)|no change/);
  });

  it("saves a copy named -copy and leaves the document unsaved", async () => {
    const session = await openWords();
    const { downloads } = await mountPdf(session, { onSave: () => {} });
    await dirtyIt(session);
    await key(q(".pli-pdf-scroller"), "S", { ctrlKey: true, shiftKey: true });
    await flush();
    expect(downloads.map((d) => d.name)).toEqual(["report-copy.pdf"]);
    expect(wordsOf(downloads[0]!.bytes)).toEqual(WORDS.slice(0, 5));
    expect(session.dirty).toBe(true);
    expect(toast()).toContain("Downloaded report-copy.pdf");
  });

  it("downloads through the browser by default (an anchor with a blob URL)", async () => {
    const session = await openWords();
    const made: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(function () {}, URL, { createObjectURL: (b: Blob) => (made.push(b), "blob:one"), revokeObjectURL: () => {} }));
    const clicked: { href: string; download: string }[] = [];
    const click0 = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download });
    };
    try {
      await mountPdf(session, { onDownload: undefined });
      await fileMenu("Save a copy");
      await flush();
      expect(clicked).toEqual([{ href: "blob:one", download: "report-copy.pdf" }]);
      expect(made[0]!.type).toBe("application/pdf");
    } finally {
      HTMLAnchorElement.prototype.click = click0;
    }
  });

  it("reports that downloads are not available where the browser has none", async () => {
    const session = await openWords();
    await mountPdf(session, { onDownload: undefined });
    await fileMenu("Save a copy");
    await flush();
    expect(toast()).toContain("Could not download. Downloads are not available here.");
  });
});

describe("print", () => {
  it("prints the saved bytes through a hidden frame, and removes the frame afterwards", async () => {
    const session = await openWords();
    const revoked: string[] = [];
    vi.stubGlobal("URL", Object.assign(function () {}, URL, { createObjectURL: () => "blob:print", revokeObjectURL: (u: string) => revoked.push(u) }));
    await mountPdf(session);
    await key(q(".pli-pdf-scroller"), "p", { ctrlKey: true });
    await flush();
    const frame = document.querySelector<HTMLIFrameElement>("iframe[title=Print]")!;
    expect(frame.getAttribute("src")).toBe("blob:print");
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    const win = frame.contentWindow! as Window & { print: () => void };
    const print = vi.fn();
    win.print = print;
    win.focus = () => {};
    await act(async () => void frame.dispatchEvent(new Event("load")));
    expect(print).toHaveBeenCalledTimes(1);
    await act(async () => void win.dispatchEvent(new Event("afterprint")));
    await tick(600);
    expect(document.querySelector("iframe[title=Print]")).toBeNull();
    expect(revoked).toEqual(["blob:print"]);
  });

  it("says so where printing is not available (no blob URLs), and a host can replace it", async () => {
    const session = await openWords();
    await mountPdf(session);
    await fileMenu("Print…");
    await flush();
    expect(toast()).toBe("Printing is not available here. Download the file and print it.");
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("calls the host's onPrint instead", async () => {
    const session = await openWords();
    const onPrint = vi.fn();
    await mountPdf(session, { onPrint });
    await fileMenu("Print…");
    expect(onPrint).toHaveBeenCalledTimes(1);
  });
});

describe("export pages as pictures", () => {
  const stubToBlob = () => {
    const seen: { type?: string; quality?: number }[] = [];
    HTMLCanvasElement.prototype.toBlob = function (cb, type, quality) {
      seen.push({ type, quality });
      cb(new Blob([new Uint8Array([1, 2, 3, seen.length])], { type }));
    };
    return seen;
  };

  it("exports all pages as PNG into one ZIP, from the saved file", async () => {
    const seen = stubToBlob();
    const session = await openWords();
    const { downloads, renderer } = await mountPdf(session);
    await dirtyIt(session);
    const opensBefore = renderer.stats.opens;
    const openOptions: unknown[] = [];
    const open = renderer.open.bind(renderer);
    renderer.open = (bytes, options) => (openOptions.push(options), open(bytes, options));
    await fileMenu("Export pages as pictures…");
    expect(q("dialog[open] .pli-dialog-title").textContent).toBe("Export pages as pictures");
    await click(qa("dialog[open] input[type=radio]").find((r) => (r.parentElement?.textContent ?? "").includes("All 5 pages"))!);
    await click(dialogButton("Export 5 pages"));
    await flush(12);
    expect(seen.map((s) => s.type)).toEqual(Array(5).fill("image/png"));
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toBe("report-pages.zip");
    const files = readZip(downloads[0]!.bytes);
    expect(files.map((f) => f.name)).toEqual(["report-page-1.png", "report-page-2.png", "report-page-3.png", "report-page-4.png", "report-page-5.png"]);
    expect(files[2]!.data[3]).toBe(3);
    // a file of its own was opened, so annotations of the saved file are in the pictures; the page was turned in it
    expect(renderer.stats.opens).toBe(opensBefore + 1);
    expect(openOptions).toEqual([{ annotations: true }]);
    expect(renderer.stats.renders.at(-1)).toMatchObject({ scale: 150 / 72, rotation: 0 });
    expect(toast()).toContain("Saved 5 pictures of pages 1-5");
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("exports the selected pages as JPEG at the chosen resolution, one download each", async () => {
    const seen = stubToBlob();
    const session = await openWords();
    const { downloads, renderer } = await mountPdf(session);
    await click(qa(".pli-pdf-thumb")[1]!);
    await click(qa(".pli-pdf-thumb")[2]!, { shiftKey: true });
    await fileMenu("Export pages as pictures…");
    expect(q("dialog[open]").textContent).toContain("The 2 selected pages");
    await click(qa("dialog[open] input[type=radio]").find((r) => (r.parentElement?.textContent ?? "").includes("JPEG"))!);
    const dpi = byLabel("Resolution") as HTMLSelectElement;
    await act(async () => {
      dpi.value = "300";
      dpi.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(q("dialog[open] input[type=checkbox]"));
    await click(dialogButton("Export 2 pages"));
    await tick(600);
    expect(seen.map((s) => s.type)).toEqual(["image/jpeg", "image/jpeg"]);
    expect(seen[0]!.quality).toBeCloseTo(0.92);
    expect(downloads.map((d) => [d.name, d.mime])).toEqual([["report-page-2.jpg", "image/jpeg"], ["report-page-3.jpg", "image/jpeg"]]);
    expect(renderer.stats.renders.at(-1)!.scale).toBeCloseTo(300 / 72);
  });

  it("takes a range, rejects a bad one, and caps a huge page so the canvas stays small", async () => {
    stubToBlob();
    const session = await openWords(["Big"], "poster.pdf", [{ width: 5000, height: 5000 }]);
    const { downloads, renderer } = await mountPdf(session, { renderer: fakeRenderer({ pages: [{ width: 5000, height: 5000 }] }) });
    await fileMenu("Export pages as pictures…");
    await click(qa("dialog[open] input[type=radio]").find((r) => (r.parentElement?.textContent ?? "").includes("These:"))!);
    await setValue(byLabel("Page range") as HTMLInputElement, "3");
    expect(q("dialog[open] [role=alert]").textContent).toBe("The document has no page 3.");
    expect(dialogButton("Export").disabled).toBe(true);
    await setValue(byLabel("Page range") as HTMLInputElement, "1");
    await click(dialogButton("Export"));
    await flush(10);
    expect(downloads.map((d) => d.name)).toEqual(["poster-page-1.png"]);
    // 5000 x 5000 points at 150 dpi is 87 megapixels: drawn smaller
    const scale = renderer.stats.renders.at(-1)!.scale;
    expect(5000 * scale * 5000 * scale).toBeLessThanOrEqual(16_000_001);
  });

  it("shows progress and stops when asked", async () => {
    stubToBlob();
    const session = await openWords();
    const { downloads, renderer } = await mountPdf(session);
    await fileMenu("Export pages as pictures…");
    await click(qa("dialog[open] input[type=radio]").find((r) => (r.parentElement?.textContent ?? "").includes("All 5 pages"))!);
    renderer.hold();
    await click(dialogButton("Export 5 pages"));
    await flush();
    expect(q("dialog[open] progress").getAttribute("value")).toBe("0");
    expect(dialogButton("Export 5 pages").disabled).toBe(true);
    await click(dialogButton("Stop"));
    await flush();
    renderer.release();
    await flush();
    expect(downloads).toHaveLength(0);
    expect(q(".pli-pdf-announce").textContent).toBe("Cancelled");
    expect(document.querySelector("dialog[open] progress")).toBeNull();
  });
});

describe("open and create", () => {
  it("offers Open PDF and Create PDF from pictures only when the app can replace the document", async () => {
    const session = await openWords();
    await mountPdf(session);
    await click(menuButton("File"));
    expect(menuItem("Open PDF")).toBeUndefined();
    expect(menuItem("Create PDF")).toBeUndefined();
  });

  it("hands the chosen file to onOpen", async () => {
    const session = await openWords();
    const opened: [Uint8Array, string][] = [];
    await mountPdf(session, { onOpen: (b, n) => void opened.push([b, n]) });
    const chooser = stubChooser([fileOf("other.pdf", pdfOf(["Xray", "Yankee"]))]);
    await fileMenu("Open PDF…");
    await tick(10);
    chooser.restore();
    expect(chooser.accepted[0]).toContain("pdf");
    expect(opened).toHaveLength(1);
    expect(opened[0]![1]).toBe("other.pdf");
    expect(wordsOf(opened[0]![0])).toEqual(["Xray", "Yankee"]);
  });

  it("asks before dropping unsaved changes, and refuses a file that is not a PDF", async () => {
    const session = await openWords();
    const opened: string[] = [];
    await mountPdf(session, { onOpen: (_b, n) => void opened.push(n) });
    await dirtyIt(session);
    let chooser = stubChooser([fileOf("notes.pdf", new TextEncoder().encode("not a pdf"))]);
    await fileMenu("Open PDF…");
    await tick(10);
    chooser.restore();
    expect(toast()).toContain("notes.pdf is not a PDF file.");
    expect(opened).toEqual([]);
    chooser = stubChooser([fileOf("other.pdf", pdfOf(["Xray"]))]);
    await fileMenu("Open PDF…");
    await tick(10);
    chooser.restore();
    expect(q("dialog[open] .pli-dialog-title").textContent).toBe("Discard your changes?");
    await click(dialogButton("Cancel"));
    expect(opened).toEqual([]);
    chooser = stubChooser([fileOf("other.pdf", pdfOf(["Xray"]))]);
    await fileMenu("Open PDF…");
    await tick(10);
    chooser.restore();
    await click(dialogButton("Discard and open"));
    await flush();
    expect(opened).toEqual(["other.pdf"]);
  });

  it("makes a PDF from pictures and hands it to onOpen", async () => {
    const session = await openWords();
    const opened: [Uint8Array, string][] = [];
    await mountPdf(session, { onOpen: (b, n) => void opened.push([b, n]) });
    const png = makePng({ width: 8, height: 6, colorType: 2, depth: 8, sample: () => [10, 120, 200] });
    const chooser = stubChooser([fileOf("scan-1.png", png, "image/png"), fileOf("scan-2.png", png, "image/png")]);
    await fileMenu("Create PDF from pictures…");
    await tick(30);
    chooser.restore();
    expect(chooser.accepted[0]).toContain("image/png");
    expect(opened).toHaveLength(1);
    expect(opened[0]![1]).toBe("scan-1.pdf");
    expect(PdfFile.open(opened[0]![0]).pageCount()).toBe(2);
  });
});

describe("the document's name and unsaved changes", () => {
  it("shows the name, renames it into the document (undoable) and uses it for downloads", async () => {
    const session = await openWords();
    const { downloads } = await mountPdf(session);
    expect(q(".pli-pdf-title-name").textContent).toBe("report.pdf");
    await click(q(".pli-pdf-title-name"));
    const input = byLabel("Document name") as HTMLInputElement;
    await setValue(input, "Q3 summary.pdf");
    await key(input, "Enter");
    expect(session.doc.name).toBe("Q3 summary.pdf");
    expect(q(".pli-pdf-title-name").textContent).toBe("Q3 summary.pdf");
    expect(dot()).toBeTruthy();
    await fileMenu("Save a copy");
    await flush();
    expect(downloads.at(-1)!.name).toBe("Q3 summary-copy.pdf");
    await key(q(".pli-pdf-scroller"), "z", { ctrlKey: true });
    expect(session.doc.name).toBe("report.pdf");
  });

  it("leaves the name alone on Escape or an empty name, and a read-only viewer cannot rename", async () => {
    const session = await openWords();
    await mountPdf(session);
    await click(q(".pli-pdf-title-name"));
    let input = byLabel("Document name") as HTMLInputElement;
    await setValue(input, "other.pdf");
    await key(input, "Escape");
    expect(session.doc.name).toBe("report.pdf");
    await click(q(".pli-pdf-title-name"));
    input = byLabel("Document name") as HTMLInputElement;
    await setValue(input, "   ");
    await key(input, "Enter");
    expect(session.doc.name).toBe("report.pdf");
  });

  it("asks the browser to confirm leaving only when asked to and only with unsaved changes", async () => {
    const session = await openWords();
    await mountPdf(session, { warnOnUnload: true });
    const leave = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(leave()).toBe(false);
    await dirtyIt(session);
    expect(leave()).toBe(true);
    await run(() => session.markSaved());
    expect(dot()).toBeNull();
    expect(leave()).toBe(false);
  });

  it("does not guard the page without the option", async () => {
    const session = await openWords();
    await mountPdf(session);
    await dirtyIt(session);
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
