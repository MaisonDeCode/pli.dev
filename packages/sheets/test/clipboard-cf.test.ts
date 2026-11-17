import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, parseHtmlTable } from "../src";

const make = () => new SheetSession(createWorkbook("T", ["Sheet1", "Sheet2"]), { now: () => 45_000.5 });
const stripMark = (html: string) => html.replace(/ data-pli-cf="[^"]*"/, "");
const gradients = (html: string) => [...html.matchAll(/linear-gradient\(90deg[^;"]*/g)].map((m) => m[0]);
const icons = (html: string) => [...html.matchAll(/data:image\/svg\+xml,([^")]*)/g)].map((m) => decodeURIComponent(m[1]!));

const barred = () => {
  const s = make();
  s.setValues("Sheet1", "A1", [["Sales"], [0], [25], [50], [100]]);
  s.addRule("Sheet1", { kind: "dataBar", ranges: ["A2:A5"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6" } as never);
  return s;
};

const iconed = () => {
  const s = make();
  s.setValues("Sheet1", "A1", [[5], [50], [70], [500], [90]]);
  s.addRule("Sheet1", { kind: "iconSet", set: "3Arrows", ranges: ["A1:A5"], thresholds: [{ type: "num", value: 60 }, { type: "num", value: 100 }] } as never);
  return s;
};

describe("data bars and icon sets in the HTML of a copy", () => {
  it("are marked with the rules that cover the copied cells", () => {
    const html = barred().toHtml("Sheet1", "A1:A5");
    expect(html).toContain("data-pli-cf=");
    const t = parseHtmlTable(html)!;
    expect(t.cf).toHaveLength(1);
    expect(t.cf![0]).toMatchObject({ at: [2, 1], pieces: [[1, 0, 4, 0]], rule: { kind: "dataBar", color: "#638ec6" } });
    expect(t.cf![0]!.rule).not.toHaveProperty("id");
    expect(t.cf![0]!.rule).not.toHaveProperty("ranges");
  });

  it("are left out of the mark when the copy has none of them, and colour scales and other rules are not in it", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1], [2]]);
    s.addRule("Sheet1", { kind: "colorScale", ranges: ["A1:A2"], stops: [{ type: "min", color: "#ffffff" }, { type: "max", color: "#ff0000" }] } as never);
    expect(s.toHtml("Sheet1", "A1:A2")).not.toContain("data-pli-cf");
    const b = barred();
    expect(b.toHtml("Sheet1", "D1:D3")).not.toContain("data-pli-cf");
  });
});

describe("pasting them back", () => {
  it("makes the data bar a rule again over the cells it lands on, and draws the same bars", () => {
    const s = barred();
    const html = s.toHtml("Sheet1", "A1:A5");
    const t = make();
    t.pasteHtml("Sheet2", "C4", html);
    const rules = t.conditionalFormats("Sheet2");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ kind: "dataBar", ranges: ["C5:C8"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6" });
    // The pasted cells are plain: the bar is drawn by the rule, not baked in as a fill.
    expect(t.cell("Sheet2", "C6")).toEqual({ v: 25, s: { align: "right" } });
    expect(gradients(t.toHtml("Sheet2", "C4:C8"))).toEqual(gradients(html));
  });

  it("makes an icon set a rule again, with its thresholds, so the icons follow the data", () => {
    const s = iconed();
    const html = s.toHtml("Sheet1", "A1:A5");
    const t = make();
    t.pasteHtml("Sheet1", "F1", html);
    expect(t.conditionalFormats("Sheet1")[0]).toMatchObject({ kind: "iconSet", set: "3Arrows", ranges: ["F1:F5"], thresholds: [{ type: "num", value: 60 }, { type: "num", value: 100 }] });
    expect(icons(t.toHtml("Sheet1", "F1:F5"))).toEqual(icons(html));
    t.setCell("Sheet1", "F1", 1000);
    expect(icons(t.toHtml("Sheet1", "F1:F1"))[0]).toContain("#2f9e44"); // now green
  });

  it("brings the part of a rule that was copied, and keeps hidden values hidden", () => {
    const s = iconed();
    s.updateRule("Sheet1", { ...s.conditionalFormats("Sheet1")[0]!, hideValue: true } as never);
    const html = s.toHtml("Sheet1", "A2:A3");
    const t = make();
    t.pasteHtml("Sheet1", "H10", html);
    expect(t.conditionalFormats("Sheet1")[0]).toMatchObject({ ranges: ["H10:H11"], hideValue: true });
  });

  it("is one undo step with the cells, and replaces the rules that covered the cells pasted over", () => {
    const html = barred().toHtml("Sheet1", "A1:A5");
    const t = make();
    t.setValues("Sheet1", "C1", [[1], [2], [3], [4], [5], [6], [7], [8]]);
    t.addRule("Sheet1", { kind: "dataBar", ranges: ["C1:C8"], min: { type: "min" }, max: { type: "max" }, color: "#ff0000" } as never);
    t.pasteHtml("Sheet1", "C3", html);
    expect(t.conditionalFormats("Sheet1").map((r) => [r.kind, r.ranges])).toEqual([["dataBar", ["C1:C2", "C8"]], ["dataBar", ["C4:C7"]]]);
    t.undo();
    expect(t.conditionalFormats("Sheet1").map((r) => r.ranges)).toEqual([["C1:C8"]]);
    expect(t.value("Sheet1", "C3")).toBe(3);
  });

  it("follows the formulas of a rule when it lands elsewhere", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, 10], [2, 20]]);
    s.addRule("Sheet1", { kind: "dataBar", ranges: ["B1:B2"], min: { type: "num", value: 0 }, max: { type: "formula", value: "A1*100" }, color: "#638ec6" } as never);
    const t = make();
    t.pasteHtml("Sheet1", "D5", s.toHtml("Sheet1", "B1:B2"));
    expect(t.conditionalFormats("Sheet1")[0]).toMatchObject({ ranges: ["D5:D6"], max: { type: "formula", value: "C5*100" } });
  });

  it("only with Paste all or Formats (values and formulas bring no rules)", () => {
    const html = barred().toHtml("Sheet1", "A1:A5");
    for (const content of ["values", "formulas"] as const) {
      const t = make();
      t.pasteHtml("Sheet1", "A1", html, { content });
      expect(t.conditionalFormats("Sheet1")).toEqual([]);
    }
    const t = make();
    t.pasteHtml("Sheet1", "A1", html, { content: "formats" });
    expect(t.conditionalFormats("Sheet1")).toHaveLength(1);
  });

  it("does not obey a mark that is damaged or asks for something else (it never makes any rule but a bar or icons)", () => {
    const html = barred().toHtml("Sheet1", "A1:A5");
    const bad = [
      html.replace(/data-pli-cf="[^"]*"/, 'data-pli-cf="not json"'),
      html.replace(/data-pli-cf="[^"]*"/, 'data-pli-cf="[{&quot;at&quot;:[1,1],&quot;pieces&quot;:[[0,0,1,0]],&quot;rule&quot;:{&quot;kind&quot;:&quot;formula&quot;,&quot;formula&quot;:&quot;1&quot;}}]"'),
      html.replace(/data-pli-cf="[^"]*"/, 'data-pli-cf="[{&quot;at&quot;:[1,1],&quot;pieces&quot;:[[0,0,1,0]],&quot;rule&quot;:{&quot;kind&quot;:&quot;dataBar&quot;}}]"'),
      html.replace(/data-pli-cf="[^"]*"/, 'data-pli-cf="[{&quot;at&quot;:[0,1],&quot;pieces&quot;:[[5,0,1,0]],&quot;rule&quot;:{&quot;kind&quot;:&quot;dataBar&quot;}}]"'),
    ];
    for (const h of bad) {
      const t = make();
      expect(() => t.pasteHtml("Sheet1", "A1", h)).not.toThrow();
      // A mark that is not understood is not obeyed; the bars themselves may still be rebuilt (see below), but nothing else is.
      expect(t.conditionalFormats("Sheet1").every((r) => r.kind === "dataBar" && r.min.type === "num")).toBe(true);
      expect(t.conditionalFormats("Sheet1").length).toBeLessThanOrEqual(1);
      expect(t.value("Sheet1", "A3")).toBe(25);
    }
  });
});

describe("pasting them back when the mark was lost on the way", () => {
  it("rebuilds an icon set from the icons themselves, with thresholds that give the same icons for the same numbers", () => {
    const s = iconed();
    const html = stripMark(s.toHtml("Sheet1", "A1:A5"));
    expect(html).not.toContain("data-pli-cf");
    const t = make();
    t.pasteHtml("Sheet1", "F1", html);
    const rule = t.conditionalFormats("Sheet1")[0]!;
    expect(rule).toMatchObject({ kind: "iconSet", set: "3Arrows", ranges: ["F1:F5"] });
    expect(icons(t.toHtml("Sheet1", "F1:F5"))).toEqual(icons(s.toHtml("Sheet1", "A1:A5")));
  });

  it("rebuilds a data bar from its length: the ends that make the same bars", () => {
    const s = barred();
    const html = stripMark(s.toHtml("Sheet1", "A1:A5"));
    const t = make();
    t.pasteHtml("Sheet1", "C4", html);
    const rules = t.conditionalFormats("Sheet2").concat(t.conditionalFormats("Sheet1"));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ kind: "dataBar", ranges: ["C5:C8"], color: "#638ec6", min: { type: "num", value: 0 }, max: { type: "num", value: 100 } });
    expect(gradients(t.toHtml("Sheet1", "C4:C8"))).toEqual(gradients(s.toHtml("Sheet1", "A1:A5")));
  });

  it("uses the smallest set that holds the icons seen (a set shares icons with bigger ones)", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1], [100]]);
    s.addRule("Sheet1", { kind: "iconSet", set: "3Arrows", ranges: ["A1:A2"], thresholds: [{ type: "num", value: 10 }, { type: "num", value: 50 }] } as never);
    const t = make();
    t.pasteHtml("Sheet1", "A1", stripMark(s.toHtml("Sheet1", "A1:A2")));
    expect(t.conditionalFormats("Sheet1")[0]).toMatchObject({ set: "3Arrows" });
  });

  it("brings no rule from a page that has other backgrounds", () => {
    const t = make();
    t.pasteHtml("Sheet1", "A1", '<table><tr><td style="background-image:linear-gradient(90deg,#fff,#000)">1</td><td style="background:url(&quot;data:image/svg+xml,%3Csvg/%3E&quot;)">2</td></tr></table>');
    expect(t.conditionalFormats("Sheet1")).toEqual([]);
  });
});

describe("what Excel and Google Sheets put on the clipboard", () => {
  it("carry no data bar or icon set: their HTML has the colours only, so a paste makes plain cells and no rules", () => {
    // Excel writes a cell under a data bar like any cell (bars and icons are not in its HTML); Sheets has only colour scales.
    const excel = '<table><tr><td class=xl65 x:num="50">50</td></tr></table>';
    const sheets = '<table><tr><td style="background-color:#57bb8a;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:50}">50</td></tr></table>';
    for (const html of [excel, sheets]) {
      const t = make();
      t.pasteHtml("Sheet1", "A1", html);
      expect(t.conditionalFormats("Sheet1")).toEqual([]);
    }
  });
});
