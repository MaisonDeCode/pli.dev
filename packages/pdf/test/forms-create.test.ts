import { describe, expect, it } from "vitest";
import { openPdf, PdfDict, PdfFile, isDict, isName } from "../src";
import type { FormField } from "../src";
import { renderPdf } from "./support/render";
import { buildClassic, simpleDoc } from "./support/handmade";

const blank = () => buildClassic(simpleDoc(2, { mediaBox: "[0 0 300 300]" })).bytes;

async function sample() {
  const bytes = blank();
  const s = await openPdf(bytes);
  return { bytes, s, page: s.doc.pages[0]!.id };
}

describe("making fields", () => {
  it("adds text, check box, radio group, drop-down, list, signature and button to a file without a form", async () => {
    const { bytes, s, page } = await sample();
    s.forms.addField(page, { type: "text", name: "name", rect: { x: 20, y: 20, w: 150, h: 22 }, value: "Hello" });
    s.forms.addField(page, { type: "text", name: "bio", rect: { x: 20, y: 50, w: 150, h: 60 }, flags: { multiline: true }, tooltip: "About you" });
    s.forms.addField(page, { type: "checkbox", name: "agree", rect: { x: 20, y: 120, w: 14, h: 14 }, value: true });
    s.forms.addField(page, { type: "radio", name: "size", buttons: [{ rect: { x: 20, y: 150, w: 14, h: 14 }, on: "S" }, { rect: { x: 50, y: 150, w: 14, h: 14 }, on: "M" }, { rect: { x: 80, y: 150, w: 14, h: 14 }, on: "L" }], value: "M" });
    s.forms.addField(page, { type: "dropdown", name: "colour", rect: { x: 20, y: 180, w: 100, h: 20 }, options: ["Red", { value: "g", label: "Green" }], value: "g" });
    s.forms.addField(page, { type: "list", name: "fruit", rect: { x: 140, y: 180, w: 100, h: 50 }, options: ["Apple", "Pear", "Fig"], flags: { multiSelect: true }, value: ["Apple", "Fig"] });
    s.forms.addField(page, { type: "signature", name: "sig", rect: { x: 20, y: 240, w: 120, h: 40 } });
    s.forms.addField(page, { type: "button", name: "send", rect: { x: 160, y: 250, w: 80, h: 24 }, caption: "Send" });
    const result = await s.saveDetailed();
    expect(result.mode).toBe("incremental");
    expect(result.warnings).toEqual([]);
    expect(result.bytes.subarray(0, bytes.length)).toEqual(bytes);

    const t = await openPdf(result.bytes);
    const by = (n: string) => t.forms.byName(n)!;
    expect(t.doc.fields.map((f) => [f.name, f.type])).toEqual(s.doc.fields.map((f) => [f.name, f.type]));
    expect(by("name")).toMatchObject({ value: "Hello", widgets: [{ page: "p:main:0", rect: { x: 20, y: 20, w: 150, h: 22 } }] });
    expect(by("bio").flags).toEqual({ multiline: true });
    expect(by("bio").tooltip).toBe("About you");
    expect(by("agree").value).toBe(true);
    expect(by("size")).toMatchObject({ value: "M" });
    expect(by("size").widgets.map((w) => w.on)).toEqual(["S", "M", "L"]);
    expect(by("colour")).toMatchObject({ value: "g", options: [{ value: "Red" }, { value: "g", label: "Green" }] });
    expect(by("fruit")).toMatchObject({ value: ["Apple", "Fig"], flags: { multiSelect: true } });
    expect(by("sig").type).toBe("signature");
    expect(by("send")).toMatchObject({ type: "button", caption: "Send" });
    expect(by("name").appearance).toMatchObject({ font: "Helvetica", size: 12, border: "#000000", borderWidth: 1 });

    // the file has an AcroForm with a font, and it is not marked as needing appearances
    const file = PdfFile.open(result.bytes);
    const form = file.dictGet(file.catalog(), "AcroForm") as PdfDict;
    expect(isDict(form)).toBe(true);
    expect(file.dictGet(form, "NeedAppearances")).toBe(false);
    expect(isDict(file.dictGet(file.dictGet(form, "DR") as PdfDict, "Font"))).toBe(true);

    // pdf.js draws them: borders, the text, the check mark, the selected radio button, the list rows, the button
    const r = await renderPdf(result.bytes, 0, 3);
    expect(r.inkIn(22, 22, 146, 18)).toBeGreaterThan(80); // "Hello"
    expect(r.inkIn(20, 50, 150, 60)).toBeGreaterThan(100); // the bio box has a border
    expect(r.inkIn(22, 122, 10, 10)).toBeGreaterThan(15); // the check mark
    expect(r.inkIn(85, 155, 4, 4)).toBe(0); // L is off
    expect(r.inkIn(55, 155, 4, 4)).toBeGreaterThan(8); // M is on
    expect(r.inkIn(142, 182, 96, 46)).toBeGreaterThan(100); // list rows
    expect(r.inkIn(162, 252, 76, 20)).toBeGreaterThan(100); // the button
  });

  it("makes hierarchical names with shared parents", async () => {
    const { s, page } = await sample();
    s.forms.addField(page, { type: "text", name: "person.first", rect: { x: 10, y: 10, w: 100, h: 20 }, value: "Ada" });
    s.forms.addField(page, { type: "text", name: "person.last", rect: { x: 10, y: 40, w: 100, h: 20 } });
    s.forms.addField(page, { type: "text", name: "person.address.city", rect: { x: 10, y: 70, w: 100, h: 20 }, value: "London" });
    const out = await s.save();
    const t = await openPdf(out);
    expect(t.doc.fields.map((f) => f.name)).toEqual(["person.first", "person.last", "person.address.city"]);
    const file = PdfFile.open(out);
    const form = file.dictGet(file.catalog(), "AcroForm") as PdfDict;
    expect((file.dictGet(form, "Fields") as unknown[]).length).toBe(1); // one root: "person"
    // a later change adds under the same parent
    const u = await openPdf(out);
    u.forms.addField(u.doc.pages[0]!.id, { type: "text", name: "person.address.zip", rect: { x: 10, y: 100, w: 60, h: 20 } });
    const out2 = await u.save();
    const f2 = PdfFile.open(out2);
    const form2 = f2.dictGet(f2.catalog(), "AcroForm") as PdfDict;
    expect((f2.dictGet(form2, "Fields") as unknown[]).length).toBe(1);
    expect((await openPdf(out2)).doc.fields.map((f) => f.name)).toContain("person.address.zip");
  });

  it("puts a widget on the right page and keeps the page's other annotations", async () => {
    const { s } = await sample();
    s.forms.addField(s.doc.pages[1]!.id, { type: "text", name: "second", rect: { x: 10, y: 10, w: 100, h: 20 }, value: "page two" });
    const t = await openPdf(await s.save());
    expect(t.forms.byName("second")!.widgets[0]!.page).toBe("p:main:1");
    const r2 = await renderPdf(await s.save(), 1, 3);
    expect(r2.inkIn(12, 12, 96, 16)).toBeGreaterThan(40);
    const r1 = await renderPdf(await s.save(), 0, 3);
    expect(r1.inkIn(5, 5, 120, 30)).toBe(0);
  });

  it("removes fields and their widgets", async () => {
    const s = await openPdf(new Uint8Array((await import("node:fs")).readFileSync(new URL("./fixtures/forms-acro.pdf", import.meta.url))));
    const before = await renderPdf(await s.save(), 0, 3);
    s.forms.remove([s.forms.byName("person.first")!.id, s.forms.byName("level")!.id]);
    const out = await s.save();
    const t = await openPdf(out);
    expect(t.doc.fields.map((f) => f.name)).toEqual(["person.last", "newsletter", "country", "stray"]);
    const after = await renderPdf(out, 0, 3);
    expect(after.inkIn(20, 30, 180, 20)).toBeLessThan(before.inkIn(20, 30, 180, 20));
    // the page has no widget of the removed fields any more
    const file = PdfFile.open(out);
    const page = file.pages()[0]!;
    const annots = file.dictGet(page.dict, "Annots") as unknown[];
    expect(annots.length).toBe(4); // last, newsletter, country, stray
  });

  it("renames a field and moves it to another group", async () => {
    const s = await openPdf(new Uint8Array((await import("node:fs")).readFileSync(new URL("./fixtures/forms-acro.pdf", import.meta.url))));
    const id = s.forms.byName("newsletter")!.id;
    s.forms.update(id, { name: "mail.optin" });
    s.forms.update(s.forms.byName("person.last")!.id, { name: "person.surname" });
    const t = await openPdf(await s.save());
    expect(t.doc.fields.map((f) => f.name).sort()).toEqual(["country", "level", "mail.optin", "person.first", "person.surname", "stray"]);
    expect(t.forms.byName("mail.optin")).toMatchObject({ type: "checkbox", value: true });
  });

  it("splits a field that is its own widget when it gets a second widget", async () => {
    const s = await openPdf(new Uint8Array((await import("node:fs")).readFileSync(new URL("./fixtures/forms-acro.pdf", import.meta.url))));
    const f = s.forms.byName("country")!;
    const page = s.doc.pages[0]!.id;
    s.core.transact([{ type: "replace_field", field: { ...f, widgets: [...f.widgets, { id: "w_new", page, rect: { x: 160, y: 160, w: 100, h: 20 } }] } }]);
    const out = await s.save();
    const t = await openPdf(out);
    const c = t.forms.byName("country")!;
    expect(c.widgets).toHaveLength(2);
    expect(c.value).toBe("fr");
    const r = await renderPdf(out, 0, 3);
    expect(r.inkIn(162, 162, 96, 16)).toBeGreaterThan(30);
  });

  it("saves a new document's fields in a rewrite too", async () => {
    const { s, page } = await sample();
    s.forms.addField(page, { type: "text", name: "t", rect: { x: 10, y: 10, w: 100, h: 20 }, value: "x" });
    const res = await s.saveDetailed({ mode: "rewrite" });
    expect(res.mode).toBe("rewrite");
    expect((await openPdf(res.bytes)).forms.byName("t")?.value).toBe("x");
  });

  it("leaves unknown keys of a field alone", async () => {
    const { buildClassic, obj, simpleDoc } = await import("./support/handmade");
    const objs = simpleDoc(1).map((o) => (o.num === 1 ? obj(1, "<< /Type /Catalog /Pages 2 0 R /AcroForm 10 0 R >>") : o.num === 3 ? obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Annots [11 0 R] >>") : o));
    objs.push(obj(10, "<< /Fields [11 0 R] /DA (/Helv 0 Tf 0 g) /CO [11 0 R] >>"));
    objs.push(obj(11, "<< /FT /Tx /T (a) /Subtype /Widget /Type /Annot /Rect [10 10 100 30] /P 3 0 R /AA << /K << /S /JavaScript /JS (AFNumber_Keystroke(2,0,0,0,\"\",true);) >> >> /Lock << /Action /All >> >>"));
    const s = await openPdf(buildClassic(objs).bytes);
    s.forms.fill({ a: "12" });
    const file = PdfFile.open(await s.save());
    const d = file.getRef(11) as PdfDict;
    expect(isDict(file.dictGet(d, "AA"))).toBe(true);
    expect(isDict(file.dictGet(d, "Lock"))).toBe(true);
    expect(isName(file.dictGet(d, "Subtype"), "Widget")).toBe(true);
    const form = file.dictGet(file.catalog(), "AcroForm") as PdfDict;
    expect(form.has("CO")).toBe(true);
  });
});

export type _Unused = FormField;
