import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openPdf } from "../src";
import { buildClassic, obj, simpleDoc } from "./support/handmade";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/${name}.pdf`, import.meta.url)));

describe("reading forms: a file made with MuPDF", () => {
  it("reads every kind of field with its value, options, flags and look", async () => {
    const { doc } = await openPdf(fixture("forms-basic"));
    const by = (n: string) => doc.fields.find((f) => f.name === n)!;
    expect(doc.fields.map((f) => [f.name, f.type])).toEqual([
      ["name", "text"],
      ["notes", "text"],
      ["agree", "checkbox"],
      ["size", "radio"],
      ["colour", "dropdown"],
      ["fruit", "list"],
      ["sig", "signature"],
      ["send", "button"],
    ]);
    expect(by("name").value).toBe("Sample Name");
    expect(by("name").id).toBe("f:name");
    expect(by("name").widgets[0]).toMatchObject({ page: "p:main:0", rect: { x: 80, y: 50, w: 200, h: 20 } });
    expect(by("name").widgets[0]!.id).toMatch(/^w:main:\d+$/);
    expect(by("name").appearance).toMatchObject({ size: 11, border: "#000000", borderWidth: 1 });
    expect(by("notes").flags).toEqual({ multiline: true });
    expect(by("agree").value).toBe(false);
    expect(by("agree").widgets[0]!.on).toBe("Yes");
    expect(by("size").widgets).toHaveLength(2);
    expect(by("size").widgets.map((w) => w.on)).toEqual(["0", "1"]);
    expect(by("size").value).toBeNull();
    expect(by("colour").value).toBe("Red");
    expect(by("colour").options).toEqual([{ value: "Red" }, { value: "Green" }, { value: "Blue" }]);
    expect(by("fruit").value).toEqual(["Plum"]);
    expect(by("sig").value).toBeNull();
    expect(by("sig").signed).toBeUndefined();
    expect(by("send").caption).toBe("Send");
    expect(by("send").appearance?.fill).toBe("#d9d9d9");
  });

  it("gives the same fields and ids to everyone who opens the same bytes", async () => {
    expect((await openPdf(fixture("forms-basic"))).doc.fields).toEqual((await openPdf(fixture("forms-basic"))).doc.fields);
  });

  it("keeps the file as it was when nothing changed", async () => {
    const bytes = fixture("forms-basic");
    const s = await openPdf(bytes);
    expect(await s.save()).toEqual(bytes);
    // a change somewhere else does not touch the form
    s.core.transact([{ type: "set_meta", patch: { title: "Other" } }]);
    const out = await s.save();
    const again = await openPdf(out);
    expect(again.doc.fields).toEqual(s.doc.fields);
  });
});

describe("reading forms: an Acrobat style file", () => {
  it("joins names, inherits entries through /Parent and finds fields outside /Fields", async () => {
    const { doc } = await openPdf(fixture("forms-acro"));
    const by = (n: string) => doc.fields.find((f) => f.name === n)!;
    expect(doc.fields.map((f) => f.name)).toEqual(["person.first", "person.last", "newsletter", "level", "country", "stray"]);
    // /FT and /DA come from the parent "person"
    expect(by("person.first")).toMatchObject({ type: "text", value: "Ada", tooltip: "First name" });
    expect(by("person.first").appearance).toMatchObject({ font: "Helvetica", size: 11, fill: "#ffffe6", border: "#000000" });
    expect(by("person.last").flags?.maxLength).toBe(8);
    expect(by("person.last").appearance?.align).toBe("center");
    // a check box that is its own widget, on
    expect(by("newsletter")).toMatchObject({ type: "checkbox", value: true });
    expect(by("newsletter").widgets[0]!.ref).toBe(by("newsletter").ref);
    // a radio group: one field, two widgets, the chosen on-state
    expect(by("level")).toMatchObject({ type: "radio", value: "B" });
    expect(by("level").widgets.map((w) => w.on)).toEqual(["A", "B"]);
    expect(by("level").ref).not.toBe(by("level").widgets[0]!.ref);
    expect(by("country").options).toEqual([{ value: "de", label: "Germany" }, { value: "fr", label: "France" }]);
    expect(by("country").value).toBe("fr");
    // on a page but not in /Fields
    expect(by("stray")).toMatchObject({ type: "text", value: "not listed" });
  });
});

describe("reading forms: broken files", () => {
  it("never throws and skips what it cannot read", async () => {
    const objs = [
      ...simpleDoc(1),
      obj(10, "<< /Fields [11 0 R 12 0 R 99 0 R (x) 13 0 R 14 0 R] /DA (garbage) >>"),
      obj(11, "<< /T (a) /Kids [11 0 R] >>"), // cycle
      obj(12, "<< /T (noType) /V (x) >>"), // no /FT: not a field
      obj(13, "<< /FT /Tx /T (ok) /V (fine) /Rect [10 10 50 30] /Subtype /Widget /P 3 0 R >>"),
      obj(14, "<< /FT /Tx /T (ok) /V (twin) /Rect [10 40 50 60] /Subtype /Widget /MaxLen (bad) /Q (bad) >>"),
    ];
    const withForm = objs.map((o) => (o.num === 1 ? obj(1, "<< /Type /Catalog /Pages 2 0 R /AcroForm 10 0 R >>") : o));
    const bytes = buildClassic(withForm).bytes;
    const s = await openPdf(bytes);
    expect(s.doc.fields.map((f) => [f.id, f.name, f.value])).toEqual([
      ["f:ok", "ok", "fine"],
      ["f:ok#2", "ok", "twin"],
    ]);
    expect(await s.save()).toEqual(bytes);
  });

  it("returns no fields for a file without a form or with a form that is not a dictionary", async () => {
    expect((await openPdf(buildClassic(simpleDoc(1)).bytes)).doc.fields).toEqual([]);
    const bad = simpleDoc(1).map((o) => (o.num === 1 ? obj(1, "<< /Type /Catalog /Pages 2 0 R /AcroForm 5 >>") : o));
    expect((await openPdf(buildClassic(bad).bytes)).doc.fields).toEqual([]);
  });
});
