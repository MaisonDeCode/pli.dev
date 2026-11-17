// @vitest-environment jsdom
// Fonts reach the saved file: a text box in "Lora" is embedded when the editor saves, downloads or flattens.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createFonts, type FontEnv, type FontSource } from "@pli.dev/core";
import { makeSamplePdf, openPdf } from "@pli.dev/pdf";
import { PdfEditor } from "../src";
import { preflight, saveBytes, withFonts } from "../src/saving";
import { fakeRenderer } from "../src/testing";
import { chooseMenu, click, flush, q, render, run, saveFile, useHost } from "./harness";
import { renderPdf } from "../../pdf/test/support/render";

useHost();
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

const lora = new Uint8Array(readFileSync(resolve(__dirname, "../../core/test/fixtures/fonts/lora-latin-400-normal.ttf")));
const env: FontEnv = { canLoad: false, register() {}, load: async () => false, isInstalled: () => false };

function registry(files: Record<string, Uint8Array | null> = { Lora: lora }) {
  const asked: { family: string; weight: number; style: string; text: string }[] = [];
  const source: FontSource = {
    name: "fake",
    faces: () => [],
    file: async (family, wanted) => {
      asked.push({ family: family.family, ...wanted });
      return files[family.family] ?? null;
    },
  };
  return { fonts: createFonts({ env, storage: null, source }), asked };
}

const contains = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(text);

async function mount(fonts: ReturnType<typeof registry>["fonts"] | undefined, extra: Record<string, unknown> = {}) {
  const session = await openPdf(await makeSamplePdf(), { name: "sample.pdf" });
  await render(<PdfEditor session={session} renderer={fakeRenderer({ pages: 2 })} viewport={{ width: 800, height: 600 }} defaultZoom={1} annotations={{ storageKey: "" }} fonts={fonts} {...extra} />);
  await flush();
  return session;
}

describe("fonts in saved files", () => {
  it("embeds the family of a text box when Save is pressed, and pdf.js finds the text", async () => {
    const { fonts, asked } = registry();
    const saved: Uint8Array[] = [];
    const session = await mount(fonts, { onSave: (b: Uint8Array) => void saved.push(b) });
    await run(() => session.annots.addFreeText(session.doc.pages[1]!.id, { x: 72, y: 300, w: 300, h: 40 }, "Lora text box", { family: "Lora", size: 18, color: "#000000" }));
    await saveFile();
    await flush();
    expect(saved).toHaveLength(1);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked[0]!.text).toContain("L");
    expect(contains(saved[0]!, "Lora")).toBe(true); // the font's name is in the file
    expect(contains(saved[0]!, "FontFile2")).toBe(true);
    expect((await renderPdf(saved[0]!, 1, 2)).inkIn(72, 300, 300, 40)).toBeGreaterThan(100); // pdf.js draws the text box from its appearance
    // the same file flattened: the text is page content, so pdf.js reads it back as text
    const flat = await saveBytes(session, { flatten: true });
    expect((await renderPdf(flat, 1, 1)).text).toContain("Lora text box");
  });

  it("without a registry the text box falls back to a standard font and the save says so", async () => {
    const saved: { bytes: Uint8Array; warnings: string[] }[] = [];
    const session = await mount(undefined, { onSave: (bytes: Uint8Array, result: { warnings: string[] }) => void saved.push({ bytes, warnings: result.warnings }) });
    await run(() => session.annots.addFreeText(session.doc.pages[1]!.id, { x: 72, y: 300, w: 300, h: 40 }, "Lora text box", { family: "Lora", size: 18 }));
    await saveFile();
    await flush();
    expect(saved[0]!.warnings.join(" ")).toMatch(/Lora/);
    expect(contains(saved[0]!.bytes, "FontFile2")).toBe(false);
  });

  it("puts a font that could not be fetched in the warnings, before the save", async () => {
    const { fonts } = registry({ Lora: null });
    const session = await mount(fonts);
    await run(() => session.annots.addFreeText(session.doc.pages[1]!.id, { x: 72, y: 300, w: 300, h: 40 }, "Hello", { family: "Lora", size: 18 }));
    const notes = await preflight(session);
    expect(notes.join(" ")).toMatch(/Lora could not be fetched/);
  });

  it("shows what a staged text edit would do before the save: a font that is missing, text that does not fit", async () => {
    const { fonts } = registry({ Lora: null });
    const session = await mount(fonts);
    const page = session.doc.pages[1]!.id;
    const run1 = (await session.content.runs(page)).find((r) => r.text.includes("quick brown fox"))!;
    await run(() => void session.content.replaceText(run1.id, "A much longer sentence than the one that was here before, set in another face", { family: "Lora" }));
    const notes = await preflight(session);
    expect(notes.some((n) => /wider than the old/.test(n))).toBe(true);
    expect(notes.some((n) => /Lora/.test(n))).toBe(true);
    // and the Download dialog lists them
    await chooseMenu("File", "Download", "More download options…");
    await flush();
    expect(q("[aria-label='Before you download']", document.body).textContent).toMatch(/wider than the old/);
  });

  it("asks for a typed signature's font and for a form field's", async () => {
    const { fonts, asked } = registry();
    const session = await mount(fonts);
    await run(() => session.annots.addSignature(session.doc.pages[0]!.id, { x: 72, y: 600, w: 160, h: 40 }, { mode: "type", text: "Sam Signer", font: "Lora" }));
    await run(() => session.forms.addField(session.doc.pages[0]!.id, { type: "text", name: "extra", rect: { x: 72, y: 650, w: 160, h: 24 }, appearance: { font: "Lora" } }));
    const { options } = await withFonts(session);
    expect(Object.keys(options.fonts ?? {})).toContain("Lora");
    expect(asked.length).toBeGreaterThan(0);
    await run(() => session.forms.setValue(session.forms.byName("extra")!.id, "Field in Lora"));
    const out = await saveBytes(session, { flatten: "forms" });
    expect(contains(out, "FontFile2")).toBe(true);
    expect((await renderPdf(out, 0, 1)).text).toContain("Field in Lora");
  });

  it("is used by the page tools: extract and flatten carry the fonts", async () => {
    const { fonts } = registry();
    const session = await mount(fonts);
    await run(() => session.annots.addFreeText(session.doc.pages[1]!.id, { x: 72, y: 300, w: 300, h: 40 }, "Lora flat", { family: "Lora", size: 18 }));
    const flat = await saveBytes(session, { flatten: true });
    expect(contains(flat, "FontFile2")).toBe(true);
    expect((await renderPdf(flat, 1, 1)).text).toContain("Lora flat");
    const part = await session.pages.extract([session.doc.pages[1]!.id], (await withFonts(session)).options);
    expect(contains(part, "FontFile2")).toBe(true);
    expect((await renderPdf(part, 0, 2)).inkIn(72, 300, 300, 40)).toBeGreaterThan(100);
  });
});
