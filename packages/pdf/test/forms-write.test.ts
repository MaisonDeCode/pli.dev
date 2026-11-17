import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openPdf, PdfDict, PdfFile, isDict, isName } from "../src";
import type { FormField, Rect } from "../src";
import { renderPdf } from "./support/render";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/${name}.pdf`, import.meta.url)));
const lora = new Uint8Array(readFileSync(new URL("../../core/test/fixtures/fonts/lora-latin-400-normal.ttf", import.meta.url)));
const open = (name: string) => openPdf(fixture(name));

/** Ink inside the inner part of a page-space rectangle (the border is left out). */
const inkInside = (r: Awaited<ReturnType<typeof renderPdf>>, rect: Rect, inset = 2): number => r.inkIn(rect.x + inset, rect.y + inset, rect.w - 2 * inset, rect.h - 2 * inset);

describe("filling an existing form", () => {
  it("appends the change to the original bytes and shows the text in pdf.js", async () => {
    const bytes = fixture("forms-basic");
    const s = await openPdf(bytes);
    const name = s.forms.byName("name")!;
    s.forms.fill({ name: "" });
    const empty = await renderPdf(await s.save(), 0, 3);
    s.forms.fill({ name: "Grace Hopper" });
    const result = await s.saveDetailed();
    expect(result.mode).toBe("incremental");
    expect(result.warnings).toEqual([]);
    expect(result.bytes.subarray(0, bytes.length)).toEqual(bytes);
    const filled = await renderPdf(result.bytes, 0, 3);
    const box = name.widgets[0]!.rect;
    expect(inkInside(empty, box)).toBe(0);
    expect(inkInside(filled, box)).toBeGreaterThan(150);
    // the text starts at the left, vertically in the middle
    expect(filled.inkIn(box.x + 2, box.y + 2, 8, box.h - 4)).toBeGreaterThan(5);
    expect(filled.inkIn(box.x + box.w - 60, box.y + 2, 56, box.h - 4)).toBe(0);
    const top = filled.inkIn(box.x + 2, box.y + 1.5, box.w - 4, 3.5);
    const bottom = filled.inkIn(box.x + 2, box.y + box.h - 5, box.w - 4, 3.5);
    expect(Math.abs(top - bottom)).toBeLessThan(top + bottom + 1);
    const again = await openPdf(result.bytes);
    expect(again.forms.byName("name")?.value).toBe("Grace Hopper");
    // the other fields are untouched
    expect(again.forms.byName("colour")?.value).toBe("Red");
  });

  it("writes a check box, a radio group, a drop-down and a list", async () => {
    const s = await open("forms-basic");
    s.forms.fill({ agree: true, size: "1", colour: "Blue", fruit: ["Pear"] });
    const out = await s.save();
    const t = await openPdf(out);
    expect(t.forms.byName("agree")?.value).toBe(true);
    expect(t.forms.byName("size")?.value).toBe("1");
    expect(t.forms.byName("colour")?.value).toBe("Blue");
    expect(t.forms.byName("fruit")?.value).toEqual(["Pear"]);
    const file = PdfFile.open(out);
    const at = (name: string) => {
      const f = t.forms.byName(name)!;
      return f.widgets.map((w) => file.getRef(Number(w.ref!.split(" ")[0])) as PdfDict);
    };
    const as = (d: PdfDict) => (isName(d.get("AS")) ? (d.get("AS") as { value: string }).value : undefined);
    expect(at("agree").map(as)).toEqual(["Yes"]);
    expect(at("size").map(as)).toEqual(["Off", "1"]);
    // the check mark and the chosen list row are drawn
    const r = await renderPdf(out, 0, 3);
    const check = t.forms.byName("agree")!.widgets[0]!.rect;
    const before = await renderPdf(fixture("forms-basic"), 0, 3);
    expect(inkInside(r, check, 1.5)).toBeGreaterThan(inkInside(before, check, 1.5) + 10);
    const fruit = t.forms.byName("fruit")!.widgets[0]!.rect;
    expect(r.pixel(fruit.x + 20, fruit.y + 29)[2]).toBeGreaterThan(r.pixel(fruit.x + 20, fruit.y + 29)[0]); // blue-ish highlight on Pear
  });

  it("turns a check box off and clears a radio group", async () => {
    const s = await open("forms-acro");
    s.forms.fill({ newsletter: false });
    s.forms.setValue("f:level", null);
    const t = await openPdf(await s.save());
    expect(t.forms.byName("newsletter")?.value).toBe(false);
    expect(t.forms.byName("level")?.value).toBeNull();
  });

  it("wraps multi-line text, centres, aligns right, sets comb cells and password bullets", async () => {
    const s = await open("forms-basic");
    const notes = s.forms.byName("notes")!;
    s.forms.fill({ notes: "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau" });
    const wrapped = await renderPdf(await s.save(), 0, 3);
    const nb = notes.widgets[0]!.rect;
    // several lines: ink in the top, the middle and near the bottom of the box
    const bandInk = (r: typeof wrapped, f: number) => r.inkIn(nb.x + 3, nb.y + nb.h * f, nb.w - 6, nb.h * 0.2);
    expect(bandInk(wrapped, 0.02)).toBeGreaterThan(20);
    expect(bandInk(wrapped, 0.3)).toBeGreaterThan(20);

    s.forms.update(s.forms.byName("name")!.id, { appearance: { align: "right" }, flags: { password: true } });
    s.forms.fill({ name: "secret" });
    const right = await renderPdf(await s.save(), 0, 3);
    const box = s.forms.byName("name")!.widgets[0]!.rect;
    expect(right.inkIn(box.x + box.w - 30, box.y + 3, 26, box.h - 6)).toBeGreaterThan(10);
    expect(right.inkIn(box.x + 3, box.y + 3, 60, box.h - 6)).toBe(0);
    expect(right.text).not.toContain("secret");

    s.forms.update(s.forms.byName("name")!.id, { appearance: { align: "left" }, flags: { password: false, comb: true, maxLength: 10 } });
    s.forms.fill({ name: "ABCDE" });
    const comb = await renderPdf(await s.save(), 0, 3);
    // five cells of 20 points: the first five have ink, the last five have none
    for (let i = 0; i < 10; i++) {
      const ink = comb.inkIn(box.x + 2 + i * 19.6 + 3, box.y + 3, 13, box.h - 6);
      if (i < 5) expect(ink, `cell ${i}`).toBeGreaterThan(8);
      else expect(ink, `cell ${i}`).toBe(0);
    }
  });

  it("clips text to the box and sizes automatic text to fit", async () => {
    const s = await open("forms-acro");
    const last = s.forms.byName("person.last")!;
    s.forms.update(last.id, { flags: { maxLength: undefined }, appearance: { size: 12 } });
    s.forms.fill({ "person.last": "x".repeat(300) });
    const out = await s.save();
    const r = await renderPdf(out, 0, 3);
    const box = last.widgets[0]!.rect;
    // nothing outside the rectangle
    expect(r.inkIn(box.x + box.w + 1, box.y - 5, 60, box.h + 10)).toBe(0);
    expect(r.inkIn(box.x, box.y + box.h + 1, box.w, 5)).toBe(0);
    // automatic size on a drop-down: the text fits
    s.forms.fill({ country: "de" });
    const r2 = await renderPdf(await s.save(), 0, 3);
    const c = s.forms.byName("country")!.widgets[0]!.rect;
    expect(inkInside(r2, c, 0)).toBeGreaterThan(40);
    expect(r2.inkIn(c.x + c.w, c.y, 30, c.h)).toBe(0);
  });

  it("removes NeedAppearances and gives every field a look", async () => {
    const s = await open("forms-acro");
    s.forms.fill({ "person.first": "Charles" });
    const out = await s.save();
    const file = PdfFile.open(out);
    const form = file.dictGet(file.catalog(), "AcroForm") as PdfDict;
    expect(file.dictGet(form, "NeedAppearances")).toBe(false);
    // the country drop-down was not filled but had no appearance: it has one now
    const t = await openPdf(out);
    const country = t.forms.byName("country")!;
    const d = file.getRef(Number(country.ref!.split(" ")[0])) as PdfDict;
    expect(isDict(file.dictGet(d, "AP"))).toBe(true);
    const r = await renderPdf(out, 0, 3);
    expect(inkInside(r, country.widgets[0]!.rect, 0)).toBeGreaterThan(40);
  });

  it("changes flags, options, tooltip and look of a field", async () => {
    const s = await open("forms-basic");
    const colour = s.forms.byName("colour")!;
    s.forms.update(colour.id, { options: ["Cyan", { value: "mag", label: "Magenta" }], flags: { required: true, editable: true }, tooltip: "Pick one", appearance: { fill: "#eeeeaa", color: "#aa0000" } });
    s.forms.fill({ colour: "mag" });
    const t = await openPdf(await s.save());
    const c = t.forms.byName("colour")!;
    expect(c.options).toEqual([{ value: "Cyan" }, { value: "mag", label: "Magenta" }]);
    expect(c.flags).toMatchObject({ required: true, editable: true });
    expect(c.tooltip).toBe("Pick one");
    expect(c.appearance).toMatchObject({ fill: "#eeeeaa", color: "#aa0000" });
    expect(c.value).toBe("mag");
    const r = await renderPdf(await s.save(), 0, 3);
    const b = c.widgets[0]!.rect;
    expect(r.pixel(b.x + b.w - 5, b.y + b.h / 2).slice(0, 3)).toEqual([238, 238, 170]);
  });

  it("moves and resizes a widget", async () => {
    const s = await open("forms-basic");
    const w = s.forms.byName("name")!.widgets[0]!;
    s.forms.setRect(w.id, { x: 20, y: 300, w: 100, h: 30 });
    s.forms.fill({ name: "Moved" });
    const out = await s.save();
    const t = await openPdf(out);
    expect(t.forms.byName("name")!.widgets[0]!.rect).toEqual({ x: 20, y: 300, w: 100, h: 30 });
    const r = await renderPdf(out, 0, 3);
    expect(inkInside(r, { x: 20, y: 300, w: 100, h: 30 })).toBeGreaterThan(50);
  });

  it("uses the AcroForm's own font object when it is there", async () => {
    const s = await open("forms-acro");
    s.forms.fill({ "person.first": "Ada Lovelace" });
    const file = PdfFile.open(await s.save());
    const form = file.dictGet(file.catalog(), "AcroForm") as PdfDict;
    const dr = file.dictGet(form, "DR") as PdfDict;
    const fonts = file.dictGet(dr, "Font") as PdfDict;
    expect(fonts.keys().sort()).toEqual(["Helv", "ZaDb"]); // nothing added
  });
});

describe("text outside Western European", () => {
  it("warns when no font file is given and draws with the font when it is", async () => {
    const s = await open("forms-basic");
    s.forms.fill({ name: "Łódź Ж" });
    const plain = await s.saveDetailed();
    expect(plain.warnings.join(" ")).toMatch(/outside Western European/);
    const noGlyph = await s.saveDetailed({ fonts: { Lora: lora } });
    expect(noGlyph.warnings.join(" ")).toMatch(/outside Western European/); // Lora has no Cyrillic
    // Lora's Latin subset has these two characters (they are outside WinAnsi), but no Cyrillic
    s.forms.fill({ name: "\u0102 \u0131" });
    const ok = await s.saveDetailed({ fonts: { Lora: lora } });
    expect(ok.warnings).toEqual([]);
    expect(ok.bytes.length).toBeGreaterThan(lora.length / 2);
    const r = await renderPdf(ok.bytes, 0, 3);
    expect(inkInside(r, s.forms.byName("name")!.widgets[0]!.rect)).toBeGreaterThan(50);
    expect((await openPdf(ok.bytes)).forms.byName("name")?.value).toBe("\u0102 \u0131");
  });
});

describe("XFA", () => {
  it("is dropped when values change, with a warning", async () => {
    const { buildClassic, obj, simpleDoc } = await import("./support/handmade");
    const objs = simpleDoc(1).map((o) => (o.num === 1 ? obj(1, "<< /Type /Catalog /Pages 2 0 R /AcroForm 10 0 R >>") : o));
    objs.push(obj(10, "<< /Fields [11 0 R] /XFA [(template) 12 0 R] /DA (/Helv 0 Tf 0 g) >>"));
    objs.push(obj(11, "<< /FT /Tx /T (a) /Subtype /Widget /Type /Annot /Rect [10 10 100 30] /P 3 0 R >>"));
    objs.push(obj(12, "<< /Length 0 >>"));
    const s = await openPdf(buildClassic(objs).bytes);
    s.forms.fill({ a: "hello" });
    const r = await s.saveDetailed();
    expect(r.warnings.join(" ")).toMatch(/XFA/);
    const file = PdfFile.open(r.bytes);
    expect((file.dictGet(file.catalog(), "AcroForm") as PdfDict).has("XFA")).toBe(false);
    expect((await openPdf(r.bytes)).forms.byName("a")?.value).toBe("hello");
  });
});

describe("types", () => {
  it("is exported", () => {
    const f: FormField = { id: "x", name: "x", type: "text", value: "", widgets: [] };
    expect(f.type).toBe("text");
  });
});
