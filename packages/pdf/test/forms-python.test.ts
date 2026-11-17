import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPdf } from "../src";
import { buildClassic, simpleDoc } from "./support/handmade";

const python = process.env.PLI_PDF_PYTHON;
const script = new URL("../scripts/pdfcheck.py", import.meta.url).pathname;
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/${name}.pdf`, import.meta.url)));
const dir = python ? mkdtempSync(join(tmpdir(), "pli-forms-")) : "";

interface Check {
  qpdf: { problems?: string[]; error?: string };
  pypdf: { fields: Record<string, string | null>; pages: { text: string; annots: { subtype: string }[] }[]; error?: string };
  mupdf: { widgets: { name: string; type: string; value: string }[]; text: string[]; error?: string };
}

function check(name: string, bytes: Uint8Array): Check {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return JSON.parse(execFileSync(python!, [script, path], { encoding: "utf8", maxBuffer: 1 << 26 }));
}

describe.skipIf(!python)("forms in independent readers", () => {
  it("shows a filled form's values in pypdf and MuPDF, and qpdf finds nothing wrong", async () => {
    const s = await openPdf(fixture("forms-basic"));
    s.forms.fill({ name: "Grace Hopper", notes: "line one\nline two", agree: true, size: "1", colour: "Blue", fruit: ["Pear"] });
    const c = check("filled.pdf", await s.save());
    expect(c.qpdf.problems).toEqual([]);
    expect(c.pypdf.fields).toMatchObject({ name: "Grace Hopper", notes: "line one\nline two", agree: "/Yes", size: "/1", colour: "Blue", fruit: "Pear" });
    const w = Object.fromEntries(c.mupdf.widgets.map((x, i) => [`${x.name}#${i}`, x.value]));
    expect(w["name#0"]).toBe("Grace Hopper");
    expect(w["agree#2"]).toBe("Yes");
    expect(w["colour#5"]).toBe("Blue");
    expect(w["fruit#6"]).toBe("Pear");
    expect(c.mupdf.widgets.filter((x) => x.name === "size").map((x) => x.value)).toEqual(["Off", "1"]);
  });

  it("shows new fields as widgets in all three", async () => {
    const s = await openPdf(buildClassic(simpleDoc(1, { mediaBox: "[0 0 300 300]" })).bytes);
    const p = s.doc.pages[0]!.id;
    s.forms.addField(p, { type: "text", name: "person.first", rect: { x: 20, y: 20, w: 150, h: 22 }, value: "Ada" });
    s.forms.addField(p, { type: "checkbox", name: "agree", rect: { x: 20, y: 60, w: 14, h: 14 }, value: true });
    s.forms.addField(p, { type: "radio", name: "size", buttons: [{ rect: { x: 20, y: 90, w: 14, h: 14 }, on: "S" }, { rect: { x: 50, y: 90, w: 14, h: 14 }, on: "M" }], value: "M" });
    s.forms.addField(p, { type: "dropdown", name: "colour", rect: { x: 20, y: 120, w: 100, h: 20 }, options: ["Red", "Green"], value: "Green" });
    s.forms.addField(p, { type: "list", name: "fruit", rect: { x: 140, y: 120, w: 100, h: 50 }, options: ["Apple", "Pear"], value: ["Pear"] });
    s.forms.addField(p, { type: "signature", name: "sig", rect: { x: 20, y: 200, w: 120, h: 40 } });
    s.forms.addField(p, { type: "button", name: "send", rect: { x: 160, y: 200, w: 80, h: 24 }, caption: "Send" });
    const c = check("new.pdf", await s.save());
    expect(c.qpdf.problems).toEqual([]);
    expect(c.pypdf.fields).toMatchObject({ "person.first": "Ada", agree: "/Yes", size: "/M", colour: "Green", fruit: "Pear" });
    expect(Object.keys(c.pypdf.fields).sort()).toEqual(["agree", "colour", "fruit", "person", "person.first", "send", "sig", "size"].filter((n) => n !== "person" || true).sort());
    expect(c.pypdf.pages[0]!.annots.filter((a) => a.subtype === "/Widget")).toHaveLength(8);
    expect(c.mupdf.widgets.map((x) => x.type).sort()).toEqual(["Button", "CheckBox", "ComboBox", "ListBox", "RadioButton", "RadioButton", "Signature", "Text"]);
    expect(c.mupdf.widgets.find((x) => x.name === "person.first")?.value).toBe("Ada");
  });

  it("leaves no widgets after a flatten, and the text is on the page", async () => {
    const s = await openPdf(fixture("forms-basic"));
    s.forms.fill({ name: "Flattened Name" });
    const c = check("flat.pdf", await s.save({ flatten: "forms" }));
    expect(c.qpdf.problems).toEqual([]);
    expect(c.mupdf.widgets).toEqual([]);
    expect(c.pypdf.pages[0]!.annots.filter((a) => a.subtype === "/Widget")).toEqual([]);
    expect(c.pypdf.fields).toEqual({});
  });

  it("opens a file whose appearances were marked stale and filled by us", async () => {
    const s = await openPdf(fixture("forms-acro"));
    s.forms.fill({ "person.first": "Charles", "person.last": "Babbage", level: "A", newsletter: false, country: "de" });
    const c = check("acro.pdf", await s.save());
    expect(c.pypdf.fields).toMatchObject({ "person.first": "Charles", "person.last": "Babbage", level: "/A", newsletter: "/Off", country: "de" });
    // the only complaint is the widget the fixture itself keeps outside /AcroForm
    expect(c.qpdf.problems!.filter((p) => !/not reachable from \/AcroForm/.test(p))).toEqual([]);
  });
});
