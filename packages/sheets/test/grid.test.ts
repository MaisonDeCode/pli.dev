import { describe, expect, it } from "vitest";
import { SheetSession, advance, caret, createWorkbook, jump, moveSelection, parseTsv, selectionBounds, wholeColumns } from "../src";

const at = (row: number, col: number) => ({ row, col });

describe("moving around", () => {
  it("steps and stays on the sheet", () => {
    expect(moveSelection(caret(at(1, 1)), "up").anchor).toEqual(at(1, 1));
    expect(moveSelection(caret(at(1, 1)), "down").anchor).toEqual(at(2, 1));
    expect(moveSelection(caret(at(5, 5)), "left").anchor).toEqual(at(5, 4));
  });

  it("extends from the focus and keeps the anchor", () => {
    let sel = caret(at(3, 3));
    sel = moveSelection(sel, "down", { extend: true });
    sel = moveSelection(sel, "right", { extend: true });
    expect(sel).toEqual({ anchor: at(3, 3), focus: at(4, 4) });
    sel = moveSelection(sel, "up", { extend: true, amount: 3 });
    expect(selectionBounds(sel)).toEqual({ r1: 1, c1: 3, r2: 3, c2: 4 });
  });

  it("Ctrl+arrow runs to the end of a block, then to the next block, then to the edge", () => {
    const filled = new Set(["2,1", "3,1", "4,1", "7,1", "8,1"]);
    const f = (r: number, c: number) => filled.has(`${r},${c}`);
    expect(jump(at(2, 1), "down", f)).toEqual(at(4, 1));
    expect(jump(at(4, 1), "down", f)).toEqual(at(7, 1));
    expect(jump(at(8, 1), "down", f)).toEqual(at(1048576, 1));
    expect(jump(at(1, 1), "down", f)).toEqual(at(2, 1));
    expect(jump(at(8, 1), "up", f)).toEqual(at(7, 1));
    expect(jump(at(7, 1), "up", f)).toEqual(at(4, 1));
    expect(jump(at(3, 5), "left", f)).toEqual(at(3, 1));
  });

  it("Enter and Tab wrap inside a selection", () => {
    const sel = { anchor: at(1, 1), focus: at(2, 2) };
    const go = (s: typeof sel, dir: "down" | "right") => advance(s, dir);
    const a = go(sel, "down");
    expect(a.active).toEqual(at(2, 1));
    expect(a.anchor).toEqual(at(1, 1)); // the selection stays
    const b = go(a, "down");
    expect(b.active).toEqual(at(1, 2));
    expect(go(go(b, "down"), "down").active).toEqual(at(1, 1));
    expect(go(sel, "right").active).toEqual(at(1, 2));
    expect(go(go(sel, "right"), "right").active).toEqual(at(2, 1));
    expect(advance(caret(at(4, 4)), "down")).toEqual(caret(at(5, 4)));
  });

  it("a whole column selection spans the sheet", () => {
    expect(selectionBounds(wholeColumns(2, 3))).toEqual({ r1: 1, c1: 2, r2: 1048576, c2: 3 });
  });
});

describe("the clipboard", () => {
  it("reads TSV with quotes, tabs and line breaks in fields", () => {
    expect(parseTsv("a\tb\n1\t2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseTsv('"x\ty"\t"line 1\nline 2"\t"say ""hi"""')).toEqual([["x\ty", "line 1\nline 2", 'say "hi"']]);
    expect(parseTsv("a\r\nb")).toEqual([["a"], ["b"]]);
    expect(parseTsv("a\t\tc")).toEqual([["a", "", "c"]]);
  });

  it("copies what shows and pastes values and formulas", () => {
    const s = new SheetSession(createWorkbook());
    s.setValues("Sheet1", "A1", [["Item", "Cost"], ["Pens", 12.5], ["Total", "=SUM(B2:B2)"]]);
    s.setFormat("Sheet1", "B2:B3", "$#,##0.00");
    expect(s.toText("Sheet1", "A1:B3")).toBe("Item\tCost\nPens\t$12.50\nTotal\t$12.50");
    expect(s.toHtml("Sheet1", "A2:B2")).toBe('<meta charset="utf-8"><table><tbody><tr><td>Pens</td><td style="text-align:right;mso-number-format:&quot;\\$\\#\\,\\#\\#0\\.00&quot;">$12.50</td></tr></tbody></table>');
    const range = s.pasteText("Sheet1", "D1", "x\t1\n=E1+1\t12%\n");
    expect(range).toBe("D1:E2");
    expect(s.values("Sheet1", "D1:E2")).toEqual([["x", 1], [2, 0.12]]);
    expect(s.cell("Sheet1", "E2")).toEqual({ v: 0.12, fmt: "0%" });
    expect(s.pasteText("Sheet1", "A9", "")).toBeNull();
    s.undo();
    expect(s.cell("Sheet1", "D1")).toBeUndefined();
  });
});

describe("the fill handle", () => {
  const fresh = () => new SheetSession(createWorkbook());
  it("continues a series of numbers, counts up text, repeats the rest", () => {
    const s = fresh();
    s.setValues("Sheet1", "A1", [[1, "Item 1", 5, "x"], [3, null, 5, "=A1*2"]]);
    s.autofill("Sheet1", "A1:A2", "A1:A5");
    expect(s.values("Sheet1", "A1:A5")).toEqual([[1], [3], [5], [7], [9]]);
    s.autofill("Sheet1", "B1", "B1:B3");
    expect(s.values("Sheet1", "B1:B3")).toEqual([["Item 1"], ["Item 2"], ["Item 3"]]);
    s.autofill("Sheet1", "C1", "C1:C3");
    expect(s.values("Sheet1", "C1:C3")).toEqual([[5], [5], [5]]);
    s.autofill("Sheet1", "D1:D2", "D1:D6");
    expect(s.cell("Sheet1", "D2")?.f).toBe("A1*2");
    expect(s.cell("Sheet1", "D4")?.f).toBe("A3*2");
    expect(s.values("Sheet1", "D1:D2")).toEqual([["x"], [2]]);
  });

  it("fills up and to the side", () => {
    const s = fresh();
    s.setValues("Sheet1", "C5", [[10, 20]]);
    s.autofill("Sheet1", "C5:D5", "A5:D5");
    expect(s.values("Sheet1", "A5:D5")).toEqual([[-10, 0, 10, 20]]);
    s.setValues("Sheet1", "F5", [[1], [2]]);
    s.autofill("Sheet1", "F5:F6", "F3:F6");
    expect(s.values("Sheet1", "F3:F6")).toEqual([[-1], [0], [1], [2]]);
  });
});
