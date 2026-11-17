import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openPdf } from "../src";
import { buildClassic, simpleDoc } from "./support/handmade";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/${name}.pdf`, import.meta.url)));
const open = (name: string) => openPdf(fixture(name));

describe("session.forms.setRects", () => {
  it("moves several widgets, also of one radio group, in one undo step", async () => {
    const s = await open("forms-basic");
    const before = s.doc;
    const size = s.forms.byName("size")!;
    s.forms.setRects([
      { widget: s.forms.byName("name")!.widgets[0]!.id, rect: { x: 100, y: 50, w: 200, h: 20 } },
      { widget: size.widgets[0]!.id, rect: { x: 10, y: 172, w: 14, h: 14 } },
      { widget: size.widgets[1]!.id, rect: { x: 40, y: 172, w: 14, h: 14 } },
    ]);
    expect(s.forms.byName("name")!.widgets[0]!.rect.x).toBe(100);
    expect(s.forms.byName("size")!.widgets.map((w) => w.rect.x)).toEqual([10, 40]);
    s.undo();
    expect(s.doc).toEqual(before);
    expect(s.canUndo).toBe(false);
  });

  it("refuses an unknown widget or an empty rectangle and changes nothing", async () => {
    const s = await open("forms-basic");
    const before = s.doc;
    expect(() => s.forms.setRects([{ widget: "w:none", rect: { x: 0, y: 0, w: 1, h: 1 } }])).toThrow(/not found/);
    expect(() => s.forms.setRects([{ widget: s.forms.byName("name")!.widgets[0]!.id, rect: { x: 0, y: 0, w: 0, h: 5 } }])).toThrow();
    expect(s.doc).toBe(before);
  });
});

describe("session.forms", () => {
  it("lists, gets and finds fields", async () => {
    const s = await open("forms-basic");
    expect(s.forms.list().map((f) => f.name)).toContain("name");
    expect(s.forms.get("f:name").name).toBe("name");
    expect(() => s.forms.get("nope")).toThrow(/not found/);
    expect(s.forms.byName("agree")?.type).toBe("checkbox");
    expect(s.forms.onPage("p:main:0")).toHaveLength(8);
    expect(s.forms.ofWidget(s.forms.byName("size")!.widgets[1]!.id)?.name).toBe("size");
  });

  it("fills several fields in one undo step and checks the values", async () => {
    const s = await open("forms-basic");
    const before = s.doc;
    const ids = s.forms.fill({ name: "Ana", agree: true, size: "0", colour: "Green", fruit: ["Fig"] });
    expect(ids).toHaveLength(5);
    expect(s.forms.byName("name")?.value).toBe("Ana");
    expect(s.forms.byName("agree")?.value).toBe(true);
    expect(s.forms.byName("fruit")?.value).toEqual(["Fig"]);
    s.undo();
    expect(s.doc).toEqual(before);
    expect(s.canUndo).toBe(false);

    const bad = (values: Record<string, unknown>, pattern: RegExp) => {
      const doc = s.doc;
      expect(() => s.forms.fill(values)).toThrow(pattern);
      expect(s.doc).toBe(doc); // nothing changed
    };
    bad({ agree: "maybe" }, /check box/);
    bad({ size: "9" }, /no button/);
    bad({ colour: "Purple" }, /no option/);
    bad({ fruit: ["Apple", "Fig"] }, /one choice/);
    bad({ name: true }, /takes text/);
    bad({ nothing: "x" }, /not found/);
    bad({ sig: "x" }, /cannot be filled/);
    bad({ name: "ok", agree: 5 }, /check box/);
    try {
      s.forms.fill({ sig: "x" });
    } catch (e) {
      expect((e as { code: string }).code).toBe("invalid_operation");
    }
  });

  it("accepts a drop-down's label, an editable drop-down's own text, and the on name for a check box", async () => {
    const s = await open("forms-acro");
    s.forms.fill({ country: "Germany" });
    expect(s.forms.byName("country")?.value).toBe("de");
    expect(() => s.forms.fill({ country: "Spain" })).toThrow();
    s.forms.update("f:country", { flags: { editable: true } });
    s.forms.fill({ country: "Spain" });
    expect(s.forms.byName("country")?.value).toBe("Spain");
    s.forms.fill({ newsletter: "Yes" });
    expect(s.forms.byName("newsletter")?.value).toBe(true);
    s.forms.fill({ level: null });
    expect(s.forms.byName("level")?.value).toBeNull();
  });

  it("refuses read-only fields and too long text", async () => {
    const s = await open("forms-acro");
    s.forms.update("f:person.last", { flags: { readOnly: true } });
    expect(() => s.forms.fill({ "person.last": "x" })).toThrow(/read only/);
    expect(() => s.forms.setValue("f:person.last", "x")).toThrow(/read only/);
    s.forms.setValue("f:person.last", "x", { force: true });
    expect(s.forms.byName("person.last")?.value).toBe("x");
    s.forms.update("f:person.last", { flags: { readOnly: undefined } });
    expect(() => s.forms.fill({ "person.last": "123456789" })).toThrow(/at most 8/);
    s.forms.fill({ "person.last": "12345678" });
  });

  it("resets to default values", async () => {
    const s = await open("forms-basic");
    s.forms.update("f:colour", { defaultValue: "Green" });
    s.forms.fill({ name: "x", agree: true, colour: "Blue" });
    s.forms.reset();
    expect(s.forms.byName("name")?.value).toBe("");
    expect(s.forms.byName("agree")?.value).toBe(false);
    expect(s.forms.byName("colour")?.value).toBe("Green");
    s.undo();
    expect(s.forms.byName("name")?.value).toBe("x");
  });

  it("reports problems: required, too long, not an option", async () => {
    const s = await open("forms-acro");
    expect(s.forms.isValid()).toBe(true);
    s.forms.update("f:person.last", { flags: { required: true } });
    expect(s.forms.problems()).toEqual([{ field: "f:person.last", name: "person.last", kind: "required", message: "person.last is required" }]);
    s.forms.fill({ "person.last": "Ok" });
    expect(s.forms.isValid()).toBe(true);
    s.forms.update("f:person.last", { flags: { maxLength: 1 } });
    expect(s.forms.problems().map((p) => p.kind)).toEqual(["maxLength"]);
    s.forms.update("f:person.last", { flags: { maxLength: undefined } });
    s.core.transact([{ type: "set_value", id: "f:country", value: "zz" }]);
    expect(s.forms.problems().map((p) => p.kind)).toEqual(["option"]);
  });

  it("exports and imports data", async () => {
    const s = await open("forms-acro");
    const data = s.forms.exportData();
    expect(data).toEqual({ "person.first": "Ada", "person.last": "", newsletter: true, level: "B", country: "fr", stray: "not listed" });
    const t = await open("forms-acro");
    const r = t.forms.importData(JSON.stringify({ "person.first": "Bo", newsletter: false, level: "A", missing: "x", country: "Mars", "person.last": "1234567890" }));
    expect(r.applied).toEqual(["person.first", "newsletter", "level"]);
    expect(r.skipped.map((x) => x.name)).toEqual(["missing", "country", "person.last"]);
    expect(t.forms.exportData()).toMatchObject({ "person.first": "Bo", newsletter: false, level: "A", country: "fr" });
    expect(() => t.forms.importData("{")).toThrow(/JSON/);
    expect(() => t.forms.importData("[1]")).toThrow(/object/);
    t.undo();
    expect(t.forms.exportData()).toEqual(data);
  });

  it("adds fields with checks on names and rectangles", async () => {
    const s = await openPdf(buildClassic(simpleDoc(1)).bytes);
    const page = s.doc.pages[0]!.id;
    const id = s.forms.addField(page, { type: "text", name: "a.b", rect: { x: 0, y: 0, w: 10, h: 10 } });
    expect(s.selection.fields).toEqual([id]);
    expect(() => s.forms.addField(page, { type: "text", name: "a.b", rect: { x: 0, y: 0, w: 10, h: 10 } })).toThrow(/already/);
    expect(() => s.forms.addField(page, { type: "text", name: "a", rect: { x: 0, y: 0, w: 10, h: 10 } })).toThrow(/group/);
    expect(() => s.forms.addField(page, { type: "text", name: "a.b.c", rect: { x: 0, y: 0, w: 10, h: 10 } })).toThrow(/holds a value/);
    expect(() => s.forms.addField(page, { type: "text", name: "x", rect: { x: 0, y: 0, w: 0, h: 10 } })).toThrow(/rectangle/);
    expect(() => s.forms.addField(page, { type: "text", name: "", rect: { x: 0, y: 0, w: 5, h: 5 } })).toThrow(/name/);
    expect(() => s.forms.addField("nope", { type: "text", name: "z", rect: { x: 0, y: 0, w: 5, h: 5 } })).toThrow(/not found/);
    expect(() => s.forms.addField(page, { type: "radio", name: "r" })).toThrow(/buttons/);
    expect(() => s.forms.addField(page, { type: "radio", name: "r", buttons: [{ rect: { x: 0, y: 0, w: 5, h: 5 }, on: "A" }, { rect: { x: 9, y: 0, w: 5, h: 5 }, on: "A" }] })).toThrow(/two radio/);
    expect(() => s.forms.addField(page, { type: "dropdown", name: "d", rect: { x: 0, y: 0, w: 5, h: 5 }, options: ["a"], value: "b" })).toThrow(/no option/);
    expect(s.forms.nameProblem("fresh")).toBeUndefined();
  });

  it("updates, renames with a uniqueness check, resizes and removes", async () => {
    const s = await open("forms-basic");
    s.forms.update("f:name", { name: "full_name", tooltip: "Your name", appearance: { size: 14, align: "center" }, flags: { required: true } });
    const f = s.forms.byName("full_name")!;
    expect(f).toMatchObject({ id: "f:name", tooltip: "Your name", flags: { required: true } });
    expect(f.appearance).toMatchObject({ size: 14, align: "center", border: "#000000" });
    expect(() => s.forms.update("f:name", { name: "notes" })).toThrow(/already/);
    expect(() => s.forms.update("f:colour", { caption: "x" })).toThrow(/not a button/);
    expect(() => s.forms.update("f:name", { options: ["a"] })).toThrow(/no options/);
    s.forms.update("f:name", { flags: { required: undefined }, tooltip: null });
    expect(s.forms.byName("full_name")).not.toHaveProperty("tooltip");
    expect(s.forms.byName("full_name")!.flags).toBeUndefined();
    const w = f.widgets[0]!;
    s.forms.setRect(w.id, { x: 1, y: 2, w: 30, h: 12 });
    expect(s.forms.byName("full_name")!.widgets[0]!.rect).toEqual({ x: 1, y: 2, w: 30, h: 12 });
    expect(() => s.forms.setRect(w.id, { x: 1, y: 2, w: 0, h: 12 })).toThrow();
    expect(() => s.forms.setRect("w:none", { x: 1, y: 2, w: 3, h: 4 })).toThrow(/not found/);
    s.forms.remove(["f:name", "f:notes", "f:nothing"]);
    expect(s.forms.byName("full_name")).toBeUndefined();
    s.undo();
    expect(s.forms.byName("full_name")).toBeDefined();
  });
});

