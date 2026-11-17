import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx, type Value } from "../src";

const DATA = [
  ["Region", "Product", "Qty", "Sales"],
  ["East", "Apple", 10, 100],
  ["East", "Pear", 5, 40],
  ["West", "Apple", 7, 70],
  ["West", "Pear", 3, 33],
  ["East", "Apple", 2, 20],
  ["North", "Plum", 4, 44],
  ["North", "Apple", 8, 81],
];

function make() {
  const s = new SheetSession(createWorkbook("g"));
  s.setValues("Sheet1", "A1", DATA);
  return s;
}
/** What a formula spills into, from M1, as rows (as many as it fills, trailing empty cells dropped). */
function result(formula: string, s = make()): Value[][] {
  s.setCell("Sheet1", "M1", "=" + formula);
  const rows: Value[][] = [];
  for (let r = 1; r <= 30; r++) {
    const row: Value[] = [];
    for (let c = 0; c < 12; c++) row.push(s.value("Sheet1", `${String.fromCharCode(77 + c)}${r}`));
    while (row.length && (row[row.length - 1] === null || row[row.length - 1] === "")) row.pop();
    if (!row.length && r > 1) break;
    rows.push(row);
  }
  return rows.filter((r) => r.length);
}

describe("GROUPBY", () => {
  it("adds up each group, sorted, with a header row and a grand total", () => {
    expect(result("GROUPBY(A1:A8,D1:D8,SUM,3)")).toEqual([["Region", "Sales"], ["East", 160], ["North", 125], ["West", 103], ["Total", 388]]);
  });

  it("finds the headers by itself and never shows them (as Excel does), with a grand total alone", () => {
    // One field: the header is found (and kept out of the sums) but not shown.
    expect(result("GROUPBY(A1:A8,D1:D8,SUM)")).toEqual([["East", 160], ["North", 125], ["West", 103], ["Total", 388]]);
    // Two fields: not shown either, and no subtotals unless total_depth asks (Excel's own answer for this formula).
    expect(result("GROUPBY(A1:B8,D1:D8,SUM)")).toEqual([
      ["East", "Apple", 120],
      ["East", "Pear", 40],
      ["North", "Apple", 81],
      ["North", "Plum", 44],
      ["West", "Apple", 70],
      ["West", "Pear", 33],
      ["Total", "", 388],
    ]);
  });

  it("leaves the header out when the data has none, and finds it when it is there", () => {
    expect(result("GROUPBY(A2:A8,D2:D8,SUM)")).toEqual([["East", 160], ["North", 125], ["West", 103], ["Total", 388]]);
    expect(result("GROUPBY(A1:A8,D1:D8,SUM,1)")).toEqual([["East", 160], ["North", 125], ["West", 103], ["Total", 388]]);
    // Made-up names, as Excel names them.
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,2,1)")[0]).toEqual(["Row Field 1", "Value 1"]);
    expect(result("GROUPBY(A2:B8,D2:D8,SUM,2)")[0]).toEqual(["Row Field 1", "Row Field 2", "Value 1"]);
    // Told there is no header, "Region" is a group of its own (and "Sales" adds up to nothing).
    expect(result("GROUPBY(A1:A8,D1:D8,SUM,0,0)")).toContainEqual(["Region", 0]);
  });

  it("takes the functions by name or as a LAMBDA", () => {
    const by = (f: string) => result(`GROUPBY(A2:A8,D2:D8,${f},0,0)`).map((r) => r[1]);
    expect(by("AVERAGE")).toEqual([160 / 3, 62.5, 103 / 2]);
    expect(by("COUNT")).toEqual([3, 2, 2]);
    expect(by("MAX")).toEqual([100, 81, 70]);
    expect(by("MIN")).toEqual([20, 44, 33]);
    expect(by("LAMBDA(x,SUM(x)*2)")).toEqual([320, 250, 206]);
    expect(by("LAMBDA(x,MAX(x)-MIN(x))")).toEqual([80, 37, 37]);
  });

  it("gives each group's share with PERCENTOF", () => {
    const r = result("GROUPBY(A2:A8,D2:D8,PERCENTOF)");
    expect(r.map((x) => x[0])).toEqual(["East", "North", "West", "Total"]);
    expect(r[0]![1]).toBeCloseTo(160 / 388, 12);
    expect(r[3]![1]).toBe(1);
    // A LAMBDA with two names gets the group and then everything.
    expect(result("GROUPBY(A2:A8,D2:D8,LAMBDA(x,all,SUM(x)/SUM(all)),0,0)")[1]![1]).toBeCloseTo(125 / 388, 12);
  });

  it("gives a column for each of several functions, or each function its own value column when there are as many", () => {
    // A row of the functions' names goes over the columns (Excel does this with several functions, even when the headers are not shown).
    expect(result("GROUPBY(A1:A8,D1:D8,HSTACK(SUM,COUNT),3,0)")).toEqual([
      ["", "SUM", "COUNT"],
      ["Region", "Sales", "Sales"],
      ["East", 160, 3],
      ["North", 125, 2],
      ["West", 103, 2],
    ]);
    // Excel's own answer: two functions over two value columns make two columns (SUM of Qty, COUNT of Sales), not four.
    expect(result("GROUPBY(A2:A8,C2:D8,HSTACK(SUM,COUNT),0,0)")).toEqual([["", "SUM", "COUNT"], ["East", 17, 3], ["North", 12, 2], ["West", 10, 2]]);
    expect(result("GROUPBY(A1:A8,C1:D8,HSTACK(SUM,COUNT),3,0)")[1]).toEqual(["Region", "Qty", "Sales"]);
    // One function takes every value column; other pairings do not fit.
    expect(result("GROUPBY(A2:A8,C2:D8,SUM,0,0)")).toEqual([["East", 17, 160], ["North", 12, 125], ["West", 10, 103]]);
    expect(result("GROUPBY(A2:A8,A2:C8,HSTACK(SUM,COUNT),0,0)")[0]![0]).toEqual({ error: "#VALUE!" });
  });

  it("names the columns of several functions, or takes names under them", () => {
    expect(result("GROUPBY(A2:A8,D2:D8,HSTACK(COUNT,SUM),0,0)")).toEqual([["", "COUNT", "SUM"], ["East", 3, 160], ["North", 2, 125], ["West", 2, 103]]);
    expect(result('GROUPBY(A2:A8,D2:D8,VSTACK(HSTACK(COUNT,SUM),{"Count","Cost"}),0,0)')).toEqual([["", "Count", "Cost"], ["East", 3, 160], ["North", 2, 125], ["West", 2, 103]]);
    // Both rows when the headers are shown; one name for each function.
    expect(result('GROUPBY(A1:A8,D1:D8,VSTACK(HSTACK(COUNT,SUM),{"Count","Cost"}),3,0)')[0]).toEqual(["", "Count", "Cost"]);
    expect(result('GROUPBY(A1:A8,D1:D8,VSTACK(HSTACK(COUNT,SUM),{"Count","Cost"}),3,0)')[1]).toEqual(["Region", "Sales", "Sales"]);
    expect(result('GROUPBY(A2:A8,D2:D8,VSTACK(HSTACK(COUNT,SUM),{"Count"}),0,0)')[0]![0]).toEqual({ error: "#VALUE!" });
    expect(result('GROUPBY(A2:A8,D2:D8,VSTACK(SUM,{"Total"}),0,0)')[0]).toEqual(["", "Total"]);
  });

  it("is #VALUE! when more levels of totals are asked for than there are fields, or subtotals with the fields as a table", () => {
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,0,2)")[0]![0]).toEqual({ error: "#VALUE!" });
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,0,-2)")[0]![0]).toEqual({ error: "#VALUE!" });
    expect(result("GROUPBY(A2:B8,D2:D8,SUM,0,3)")[0]![0]).toEqual({ error: "#VALUE!" });
    expect(result("GROUPBY(A2:B8,D2:D8,SUM,0,2,,,1)")[0]![0]).toEqual({ error: "#VALUE!" });
    // Left out, only the grand total is there.
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,0)")).toHaveLength(4);
    expect(result("GROUPBY(A2:B8,D2:D8,SUM,0)")).toHaveLength(7);
    expect(result("GROUPBY(A2:B8,D2:D8,SUM,0,3,,,1)")[0]![0]).toEqual({ error: "#VALUE!" });
  });

  it("takes a vector of sort columns only for the fields", () => {
    expect(result("GROUPBY(A2:B8,D2:D8,SUM,0,0,{1,-2})").map((r) => r.join("/"))).toEqual(["East/Pear/40", "East/Apple/120", "North/Plum/44", "North/Apple/81", "West/Pear/33", "West/Apple/70"]);
    expect(result("GROUPBY(A2:B8,D2:D8,SUM,0,0,{1,3})")[0]![0]).toEqual({ error: "#VALUE!" });
  });

  it("groups by several columns, with subtotals, and puts totals at the top when the depth is negative", () => {
    // Excel's answers: the subtotal row carries the group's own name and the grand total is "Grand Total" once there are subtotals.
    expect(result("GROUPBY(A2:B8,D2:D8,SUM,0,2)")).toEqual([
      ["East", "Apple", 120],
      ["East", "Pear", 40],
      ["East", "", 160],
      ["North", "Apple", 81],
      ["North", "Plum", 44],
      ["North", "", 125],
      ["West", "Apple", 70],
      ["West", "Pear", 33],
      ["West", "", 103],
      ["Grand Total", "", 388],
    ]);
    // A depth of 1 is the grand total alone.
    expect(result("GROUPBY(A2:B8,D2:D8,SUM,0,1)").map((r) => r[0])).toEqual(["East", "East", "North", "North", "West", "West", "Total"]);
    expect(result("GROUPBY(A2:B8,D2:D8,SUM,0,-2)")).toEqual([
      ["Grand Total", "", 388],
      ["East", "", 160],
      ["East", "Apple", 120],
      ["East", "Pear", 40],
      ["North", "", 125],
      ["North", "Apple", 81],
      ["North", "Plum", 44],
      ["West", "", 103],
      ["West", "Apple", 70],
      ["West", "Pear", 33],
    ]);
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,0,-1)")[0]).toEqual(["Total", 388]);
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,0,0)")).toEqual([["East", 160], ["North", 125], ["West", 103]]);
  });

  it("sorts by a column number, descending when negative, within each group", () => {
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,0,0,-2)").map((r) => r[0])).toEqual(["East", "North", "West"]);
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,0,0,2)").map((r) => r[0])).toEqual(["West", "North", "East"]);
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,0,0,-1)").map((r) => r[0])).toEqual(["West", "North", "East"]);
    // Two fields: the second descending inside each region; the values at every level.
    expect(result("GROUPBY(A2:B8,D2:D8,SUM,0,1,-2)").slice(0, 3)).toEqual([["East", "Pear", 40], ["East", "Apple", 120], ["North", "Plum", 44]]);
    // Sorted by the sum, largest first, at both levels.
    expect(result("GROUPBY(A2:B8,D2:D8,SUM,0,1,-3)").map((r) => r.join("/"))).toEqual(["East/Apple/120", "East/Pear/40", "North/Apple/81", "North/Plum/44", "West/Apple/70", "West/Pear/33", "Total//388"]);
  });

  it("sorts the groups by their totals first when the value column is the sort key", () => {
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,0,0,2)").map((r) => r[1])).toEqual([103, 125, 160]);
    expect(result("GROUPBY(A2:A8,C2:C8,SUM,0,0,-2)").map((r) => r[0])).toEqual(["East", "North", "West"]); // 17, 12, 10
  });

  it("leaves out rows that the filter array turns off, and the header's entry", () => {
    const r = result("GROUPBY(A1:A8,D1:D8,SUM,3,1,1,{TRUE;TRUE;FALSE;TRUE;TRUE;TRUE;TRUE;FALSE})");
    // Rows 3 and 8 are out: East keeps 100 + 20, North 44, West 70 + 33.
    expect(r).toEqual([["Region", "Sales"], ["East", 120], ["North", 44], ["West", 103], ["Total", 267]]);
  });

  it("treats the fields as one table, sorted as a whole, when the relationship is 1", () => {
    const r = result("GROUPBY(A2:B8,D2:D8,SUM,0,0,-3,,1)");
    expect(r.map((x) => `${x[0]}/${x[1]}/${x[2]}`)).toEqual(["East/Apple/120", "North/Apple/81", "West/Apple/70", "North/Plum/44", "East/Pear/40", "West/Pear/33"]);
  });

  it("matches groups without regard to capitals and keeps blanks as a group of their own", () => {
    const s = make();
    s.setCell("Sheet1", "A3", "east");
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,0,0)", s)[0]).toEqual(["East", 160]);
    s.setCell("Sheet1", "A4", null as unknown as string);
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,0,0)", s).map((r) => r[1])).toContain(70);
  });

  it("is #VALUE! when the arguments don't fit and passes errors on", () => {
    expect(result("GROUPBY(A2:A7,D2:D8,SUM)")[0]![0]).toEqual({ error: "#VALUE!" });
    expect(result("GROUPBY(A2:A8,D2:D8,3)")[0]![0]).toEqual({ error: "#VALUE!" });
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,0,0,9)")[0]![0]).toEqual({ error: "#VALUE!" });
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,7)")[0]![0]).toEqual({ error: "#VALUE!" });
    const s = make();
    s.setCell("Sheet1", "D2", "=1/0");
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,0,0)", s)[0]).toEqual(["East", { error: "#DIV/0!" }]);
  });
});

describe("PIVOTBY", () => {
  it("spreads the second field across the top, with totals both ways", () => {
    // With the headers shown (Excel's layout): the column field's name has a row to itself over its labels.
    expect(result("PIVOTBY(A1:A8,B1:B8,D1:D8,SUM,3)")).toEqual([
      ["", "Product"],
      ["", "Apple", "Pear", "Plum", "Total"],
      ["Region", "Sales", "Sales", "Sales", "Sales"],
      ["East", 120, 40, "", 160],
      ["North", 81, "", 44, 125],
      ["West", 70, 33, "", 103],
      ["Total", 271, 73, 44, 388],
    ]);
  });

  it("finds the headers by itself and does not show them", () => {
    expect(result("PIVOTBY(A1:A8,B1:B8,D1:D8,SUM)")[0]).toEqual(["", "Apple", "Pear", "Plum", "Total"]);
    expect(result("PIVOTBY(A1:B8,B1:B8,D1:D8,SUM,,0)")[0]).toEqual(["", "", "Apple", "Pear", "Plum", "Total"]);
    expect(result("PIVOTBY(A1:B8,B1:B8,D1:D8,SUM,3,0)").slice(0, 3)).toEqual([["", "", "Product"], ["", "", "Apple", "Pear", "Plum", "Total"], ["Region", "Product", "Sales", "Sales", "Sales", "Sales"]]);
  });

  it("can leave the columns out, and then has only the values across the top", () => {
    expect(result("PIVOTBY(A2:A8,,D2:D8,SUM,0,1)")).toEqual([["East", 160], ["North", 125], ["West", 103], ["Total", 388]]);
    expect(result("PIVOTBY(A1:A8,,D1:D8,SUM,3)")).toEqual([["Region", "Sales"], ["East", 160], ["North", 125], ["West", 103], ["Total", 388]]);
    expect(result("PIVOTBY(A2:A8,,D2:D8,HSTACK(COUNT,SUM),0,0)")).toEqual([["", "COUNT", "SUM"], ["East", 3, 160], ["North", 2, 125], ["West", 2, 103]]);
    expect(result('PIVOTBY(A2:A8,,D2:D8,VSTACK(HSTACK(COUNT,SUM),{"Count","Cost"}),0,0)')[0]).toEqual(["", "Count", "Cost"]);
  });

  it("puts the function names under the column labels", () => {
    const r = result("PIVOTBY(A2:A8,B2:B8,D2:D8,HSTACK(COUNT,SUM),0,0,,0)");
    expect(r[0]).toEqual(["", "Apple", "Apple", "Pear", "Pear", "Plum", "Plum"]);
    expect(r[1]).toEqual(["", "COUNT", "SUM", "COUNT", "SUM", "COUNT", "SUM"]);
    expect(r[2]).toEqual(["East", 2, 120, 1, 40]);
  });

  it("is #VALUE! when more levels of totals are asked for than there are fields", () => {
    expect(result("PIVOTBY(A2:A8,B2:B8,D2:D8,SUM,0,2)")[0]![0]).toEqual({ error: "#VALUE!" });
    expect(result("PIVOTBY(A2:A8,B2:B8,D2:D8,SUM,0,1,,2)")[0]![0]).toEqual({ error: "#VALUE!" });
    expect(result("PIVOTBY(A2:B8,B2:B8,D2:D8,SUM,0,2,,2)")[0]![0]).toEqual({ error: "#VALUE!" });
  });

  it("shares with PERCENTOF relative to the column totals, or as relative_to says", () => {
    const share = (relative: string) => result(`PIVOTBY(A2:A8,B2:B8,D2:D8,PERCENTOF,0,1,,1${relative})`);
    const total = 388;
    // 0 (and left out): of the column's total.
    expect(share("")[1]).toEqual(["East", 120 / 271, 40 / 73, "", 160 / 388]);
    expect(share(",,,0")[1]).toEqual(share("")[1]);
    expect(share(",,,0").at(-1)).toEqual(["Total", 1, 1, 1, 1]);
    // 1: of the row's total.
    expect(share(",,,1")[1]).toEqual(["East", 120 / 160, 40 / 160, "", 1]);
    // 2: of everything.
    expect(share(",,,2")[1]).toEqual(["East", 120 / total, 40 / total, "", 160 / total]);
    expect(share(",,,5")[0]![0]).toEqual({ error: "#VALUE!" });
  });

  it("shares with PERCENTOF relative to the parent column or row", () => {
    // Rows Region, then Product; columns Product's partner (Region again would repeat, so use Qty parity as a second column field).
    const s = make();
    s.setCells("Sheet1", { E1: "Big", E2: "no", E3: "no", E4: "no", E5: "no", E6: "yes", E7: "no", E8: "yes" });
    // Parent row: each Product row within a region against the region's row (same column).
    const rows = result("PIVOTBY(A2:B8,E2:E8,D2:D8,PERCENTOF,0,2,,0,,,4)", s);
    // East/Apple (no): 100 of East's no (140), East/Pear 40 of 140.
    const eastApple = rows.find((r) => r[0] === "East" && r[1] === "Apple")!;
    expect(eastApple[2]).toBeCloseTo(100 / 140, 12);
    expect(eastApple[3]).toBeCloseTo(20 / 20, 12);
    // Parent column: the column field has one level, so its parent is everything: the share of the row's total.
    const cols = result("PIVOTBY(A2:A8,E2:E8,D2:D8,PERCENTOF,0,0,,0,,,3)", s);
    expect(cols[0]).toEqual(["", "no", "yes"]);
    expect(cols[1]![1]).toBeCloseTo(140 / 160, 12);
  });

  it("leaves out the headers and the totals when asked", () => {
    expect(result("PIVOTBY(A2:A8,B2:B8,D2:D8,SUM,0,0,,0)")).toEqual([["", "Apple", "Pear", "Plum"], ["East", 120, 40], ["North", 81, "", 44], ["West", 70, 33]]);
  });

  it("sorts rows and columns, and puts the totals first", () => {
    // Rows by their totals (column 2 is the first value), columns by name, descending; totals first.
    const r = result("PIVOTBY(A2:A8,B2:B8,D2:D8,SUM,0,-1,-2,-1,-1)");
    expect(r[0]).toEqual(["", "Total", "Plum", "Pear", "Apple"]);
    expect(r[1]).toEqual(["Total", 388, 44, 73, 271]);
    expect(r.slice(2).map((x) => x[0])).toEqual(["East", "North", "West"]);
    // Columns by their totals, the biggest first.
    expect(result("PIVOTBY(A2:A8,B2:B8,D2:D8,SUM,0,0,,0,-2)")[0]).toEqual(["", "Apple", "Pear", "Plum"]);
    expect(result("PIVOTBY(A2:A8,B2:B8,D2:D8,SUM,0,0,,0,2)")[0]).toEqual(["", "Plum", "Pear", "Apple"]);
  });

  it("works with a LAMBDA, PERCENTOF and a second row field with subtotals", () => {
    const r = result("PIVOTBY(A2:B8,B2:B8,D2:D8,PERCENTOF,0,2,,0)");
    expect(r[0]).toEqual(["", "", "Apple", "Pear", "Plum"]);
    // PERCENTOF here is of the column's total, by default.
    expect(r[3]).toEqual(["East", "", 120 / 271, 40 / 73]);
    expect(r[r.length - 1]![0]).toBe("Grand Total");
    const l = result("PIVOTBY(A2:A8,B2:B8,C2:C8,LAMBDA(x,COUNT(x)),0,0,,0)");
    expect(l).toEqual([["", "Apple", "Pear", "Plum"], ["East", 2, 1], ["North", 1, "", 1], ["West", 1, 1]]);
  });

  it("filters rows and is #VALUE! for mismatched fields", () => {
    const r = result("PIVOTBY(A2:A8,B2:B8,D2:D8,SUM,0,0,,0,,{TRUE;TRUE;TRUE;TRUE;FALSE;TRUE;TRUE})");
    expect(r[1]).toEqual(["East", 100, 40]);
    expect(result("PIVOTBY(A2:A8,B2:B7,D2:D8,SUM)")[0]![0]).toEqual({ error: "#VALUE!" });
  });
});

describe("the examples in Microsoft's documentation and in the tutorials that show Excel's results", () => {
  it("GROUPBY: total by a field, then sorted descending by the total (=GROUPBY(C2:C76,D2:D76,SUM,,,-2))", () => {
    expect(result("GROUPBY(B2:B8,D2:D8,SUM)")).toEqual([["Apple", 271], ["Pear", 73], ["Plum", 44], ["Total", 388]]);
    expect(result("GROUPBY(B2:B8,D2:D8,SUM,,,-2)")).toEqual([["Apple", 271], ["Pear", 73], ["Plum", 44], ["Total", 388]]);
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,,,-2)")).toEqual([["East", 160], ["North", 125], ["West", 103], ["Total", 388]]);
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,,,2)")).toEqual([["West", 103], ["North", 125], ["East", 160], ["Total", 388]]);
    expect(result("GROUPBY(A2:A8,D2:D8,SUM,,,-1)").map((r) => r[0])).toEqual(["West", "North", "East", "Total"]);
  });

  it("GROUPBY: the filter array keeps the rows that are TRUE (=GROUPBY(B4:C226,D4:E226,SUM,3,,,B4:B226=\"West\"))", () => {
    expect(result('GROUPBY(A1:B8,C1:D8,SUM,3,,,A1:A8="West")')).toEqual([["Region", "Product", "Qty", "Sales"], ["West", "Apple", 7, 70], ["West", "Pear", 3, 33], ["Total", "", 10, 103]]);
    expect(result('GROUPBY(A1:B8,D1:D8,SUM,3,0,,B1:B8<>"Apple")').map((r) => r.join("/"))).toEqual(["Region/Product/Sales", "East/Pear/40", "North/Plum/44", "West/Pear/33"]);
  });

  it("GROUPBY: several functions, as a total depth of 1, -1, 2 and -2 for two fields", () => {
    const depth = (d: number) => result(`GROUPBY(A2:B8,D2:D8,SUM,0,${d})`).map((r) => r[0] + (r[1] ? "/" + r[1] : ""));
    expect(depth(1)).toEqual(["East/Apple", "East/Pear", "North/Apple", "North/Plum", "West/Apple", "West/Pear", "Total"]);
    expect(depth(-1)[0]).toBe("Total");
    expect(depth(2)).toContain("East");
    expect(depth(2).at(-1)).toBe("Grand Total");
    expect(depth(-2).slice(0, 2)).toEqual(["Grand Total", "East"]);
  });

  it("PIVOTBY: the sales by product down and year across, sorted descending by sales (=PIVOTBY(C2:C76,A2:A76,D2:D76,SUM,,,-2))", () => {
    const r = result("PIVOTBY(B2:B8,A2:A8,D2:D8,SUM,,,-2)");
    expect(r[0]).toEqual(["", "East", "North", "West", "Total"]);
    expect(r.slice(1).map((x) => x[0])).toEqual(["Apple", "Pear", "Plum", "Total"]);
    expect(r[1]).toEqual(["Apple", 120, 81, 70, 271]);
    // Rows by the first value column (column 2), ascending.
    expect(result("PIVOTBY(B2:B8,A2:A8,D2:D8,SUM,,,2)").slice(1).map((x) => x[0])).toEqual(["Plum", "Pear", "Apple", "Total"]);
    // Both sorted at once: rows A to Z, columns Z to A.
    expect(result("PIVOTBY(B2:B8,A2:A8,D2:D8,SUM,,,1,,-1)")[0]).toEqual(["", "West", "North", "East", "Total"]);
  });

  it("PIVOTBY: the corner cell stays empty and the function names head the columns when there are several functions", () => {
    const r = result("PIVOTBY(B2:B8,,D2:D8,HSTACK(COUNT,SUM,PERCENTOF),0)");
    expect(r[0]).toEqual(["", "COUNT", "SUM", "PERCENTOF"]);
    expect(r[1]![0]).toBe("Apple");
    expect(r.at(-1)![0]).toBe("Total");
    const named = result('PIVOTBY(B2:B8,,D2:D8,VSTACK(HSTACK(COUNT,SUM,PERCENTOF),{"Count","Cost","%"}),0)');
    expect(named[0]).toEqual(["", "Count", "Cost", "%"]);
    // One label for each function.
    expect(result('PIVOTBY(B2:B8,,D2:D8,VSTACK(HSTACK(COUNT,SUM,PERCENTOF),{"Count","Cost"}),0)')[0]![0]).toEqual({ error: "#VALUE!" });
  });

  it("a vertical list of functions is a list of functions, like the one side by side", () => {
    const side = result("GROUPBY(A2:A8,D2:D8,HSTACK(SUM,COUNT),0,0)");
    expect(result("GROUPBY(A2:A8,D2:D8,VSTACK(SUM,COUNT),0,0)")).toEqual(side);
    expect(side).toEqual([["", "SUM", "COUNT"], ["East", 160, 3], ["North", 125, 2], ["West", 103, 2]]);
    expect(result("PIVOTBY(A2:A8,,D2:D8,VSTACK(SUM,COUNT),0,0)")).toEqual(result("PIVOTBY(A2:A8,,D2:D8,HSTACK(SUM,COUNT),0,0)"));
    expect(result("GROUPBY(A2:A8,D2:D8,VSTACK(HSTACK(SUM,COUNT),AVERAGE),0,0)")[0]).toEqual(["", "SUM", "COUNT", "AVERAGE"]);
    // Labels under a list of functions still need one for each function.
    expect(result('GROUPBY(A2:A8,D2:D8,VSTACK(SUM,COUNT,{"a","b"}),0,0)')[0]![0]).toEqual({ error: "#VALUE!" });
  });
});

describe("functions given by name", () => {
  it("works in the array functions that take a function", () => {
    const s = make();
    expect(result("BYROW(C2:D4,SUM)", s).map((r) => r[0])).toEqual([110, 45, 77]);
    expect(result("MAP(A2:A4,LEN)", s).map((r) => r[0])).toEqual([4, 4, 4]);
    expect(result("REDUCE(0,C2:C8,SUM)", s)[0]![0]).toBe(39);
    expect(result("SUM")[0]![0]).toEqual({ error: "#CALC!" });
    expect(result("NOSUCHNAME")[0]![0]).toEqual({ error: "#NAME?" });
  });
});

describe("in XLSX files", () => {
  it("writes the new functions with the prefix Excel uses and reads them back", () => {
    const s = make();
    s.setCell("Sheet1", "M1", "=GROUPBY(A2:A8,D2:D8,PERCENTOF)");
    s.setCell("Sheet1", "Q1", "=PERCENTOF(D2:D3,D2:D8)");
    s.setCell("Sheet1", "Q2", "=PIVOTBY(A2:A8,B2:B8,D2:D8,SUM)");
    const back = fromXlsx(toXlsx(s.state)).workbook;
    const t = new SheetSession(back);
    expect(t.cell("Sheet1", "M1")?.f).toBe("GROUPBY(A2:A8,D2:D8,PERCENTOF)");
    expect(t.value("Sheet1", "Q1")).toBeCloseTo(140 / 388, 12);
    expect(t.value("Sheet1", "N2")).toBeCloseTo(125 / 388, 12);
    expect(t.value("Sheet1", "M2")).toBe("North");
  });
});

describe("Excel's own answers for the GROUPBY and PIVOTBY blocks of the excel-check sample (42-functions-rest.xlsx, as Excel 16 computed them)", () => {
  // The file kept each block in a fixed-size array, so Excel's cells beyond its real answer are #N/A and are left out here;
  // the PIVOTBY with the headers shown was cut off one row short (the grand total row), so only the rows Excel gave are checked.
  const blocks: [string, Value[][], boolean][] = [
    ["GROUPBY(A1:A8,D1:D8,SUM)", [["East", 160.0], ["North", 125.0], ["West", 103.0], ["Total", 388.0]], false],
    ["GROUPBY(A1:A8,D1:D8,SUM,3)", [["Region", "Sales"], ["East", 160.0], ["North", 125.0], ["West", 103.0], ["Total", 388.0]], false],
    ["GROUPBY(A1:B8,D1:D8,SUM)", [["East", "Apple", 120.0], ["East", "Pear", 40.0], ["North", "Apple", 81.0], ["North", "Plum", 44.0], ["West", "Apple", 70.0], ["West", "Pear", 33.0], ["Total", "", 388.0]], false],
    ["GROUPBY(A2:B8,D2:D8,SUM,0,-2)", [["Grand Total", "", 388.0], ["East", "", 160.0], ["East", "Apple", 120.0], ["East", "Pear", 40.0], ["North", "", 125.0], ["North", "Apple", 81.0], ["North", "Plum", 44.0], ["West", "", 103.0], ["West", "Apple", 70.0], ["West", "Pear", 33.0]], false],
    ["GROUPBY(A2:A8,D2:D8,SUM,0,0,-2)", [["East", 160.0], ["North", 125.0], ["West", 103.0]], false],
    ["GROUPBY(A2:A8,C2:D8,HSTACK(SUM,COUNT),0,0)", [["", "SUM", "COUNT"], ["East", 17.0, 3.0], ["North", 12.0, 2.0], ["West", 10.0, 2.0]], false],
    ["GROUPBY(A2:A8,D2:D8,VSTACK(HSTACK(COUNT,SUM),{\"Count\",\"Cost\"}),0,0)", [["", "Count", "Cost"], ["East", 3.0, 160.0], ["North", 2.0, 125.0], ["West", 2.0, 103.0]], false],
    ["GROUPBY(A1:A8,D1:D8,PERCENTOF,3)", [["Region", "Sales"], ["East", 0.41237113402061853], ["North", 0.32216494845360827], ["West", 0.2654639175257732], ["Total", 1.0]], false],
    ["GROUPBY(A2:B8,D2:D8,SUM,0,0,-3,,1)", [["East", "Apple", 120.0], ["North", "Apple", 81.0], ["West", "Apple", 70.0], ["North", "Plum", 44.0], ["East", "Pear", 40.0], ["West", "Pear", 33.0]], false],
    ["GROUPBY(A2:A8,D2:D8,SUM,2,1)", [["Row Field 1", "Value 1"], ["East", 160.0], ["North", 125.0], ["West", 103.0], ["Total", 388.0]], false],
    ["PIVOTBY(A1:A8,B1:B8,D1:D8,SUM)", [["", "Apple", "Pear", "Plum", "Total"], ["East", 120.0, 40.0, "", 160.0], ["North", 81.0, "", 44.0, 125.0], ["West", 70.0, 33.0, "", 103.0], ["Total", 271.0, 73.0, 44.0, 388.0]], false],
    ["PIVOTBY(A1:A8,B1:B8,D1:D8,SUM,3)", [["", "Product"], ["", "Apple", "Pear", "Plum", "Total"], ["Region", "Sales", "Sales", "Sales", "Sales"], ["East", 120.0, 40.0, "", 160.0], ["North", 81.0, "", 44.0, 125.0], ["West", 70.0, 33.0, "", 103.0]], true],
    ["PIVOTBY(A2:A8,,D2:D8,SUM,0)", [["East", 160.0], ["North", 125.0], ["West", 103.0], ["Total", 388.0]], false],
    ["PIVOTBY(A2:A8,B2:B8,D2:D8,HSTACK(COUNT,SUM),0)", [["", "Apple", "Apple", "Pear", "Pear", "Plum", "Plum", "Total", "Total"], ["", "COUNT", "SUM", "COUNT", "SUM", "COUNT", "SUM", "COUNT", "SUM"], ["East", 2.0, 120.0, 1.0, 40.0, "", "", 3.0, 160.0], ["North", 1.0, 81.0, "", "", 1.0, 44.0, 2.0, 125.0], ["West", 1.0, 70.0, 1.0, 33.0, "", "", 2.0, 103.0], ["Total", 4.0, 271.0, 2.0, 73.0, 1.0, 44.0, 7.0, 388.0]], false],
    ["PIVOTBY(A2:B8,B2:B8,D2:D8,SUM,0,-2)", [["", "", "Apple", "Pear", "Plum", "Total"], ["Grand Total", "", 271.0, 73.0, 44.0, 388.0], ["East", "", 120.0, 40.0, "", 160.0], ["East", "Apple", 120.0, "", "", 120.0], ["East", "Pear", "", 40.0, "", 40.0], ["North", "", 81.0, "", 44.0, 125.0], ["North", "Apple", 81.0, "", "", 81.0], ["North", "Plum", "", "", 44.0, 44.0], ["West", "", 70.0, 33.0, "", 103.0], ["West", "Apple", 70.0, "", "", 70.0], ["West", "Pear", "", 33.0, "", 33.0]], false],
    ["PIVOTBY(A2:A8,B2:B8,D2:D8,PERCENTOF,0,1,,1,,,0)", [["", "Apple", "Pear", "Plum", "Total"], ["East", 0.44280442804428044, 0.547945205479452, "", 0.41237113402061853], ["North", 0.2988929889298893, "", 1.0, 0.32216494845360827], ["West", 0.25830258302583026, 0.4520547945205479, "", 0.2654639175257732], ["Total", 1.0, 1.0, 1.0, 1.0]], false],
    ["PIVOTBY(A2:A8,B2:B8,D2:D8,PERCENTOF,0,1,,1,,,1)", [["", "Apple", "Pear", "Plum", "Total"], ["East", 0.75, 0.25, "", 1.0], ["North", 0.648, "", 0.352, 1.0], ["West", 0.6796116504854369, 0.32038834951456313, "", 1.0], ["Total", 0.6984536082474226, 0.18814432989690721, 0.1134020618556701, 1.0]], false],
    ["PIVOTBY(A2:A8,B2:B8,D2:D8,PERCENTOF,0,1,,1,,,2)", [["", "Apple", "Pear", "Plum", "Total"], ["East", 0.30927835051546393, 0.10309278350515463, "", 0.41237113402061853], ["North", 0.20876288659793815, "", 0.1134020618556701, 0.32216494845360827], ["West", 0.18041237113402062, 0.08505154639175258, "", 0.2654639175257732], ["Total", 0.6984536082474226, 0.18814432989690721, 0.1134020618556701, 1.0]], false],
    ["PIVOTBY(A2:B8,B2:B8,D2:D8,PERCENTOF,0,2,,1,,,4)", [["", "", "Apple", "Pear", "Plum", "Total"], ["East", "Apple", 1.0, "", "", 0.75], ["East", "Pear", "", 1.0, "", 0.25], ["East", "", 0.44280442804428044, 0.547945205479452, "", 0.41237113402061853], ["North", "Apple", 1.0, "", "", 0.648], ["North", "Plum", "", "", 1.0, 0.352], ["North", "", 0.2988929889298893, "", 1.0, 0.32216494845360827], ["West", "Apple", 1.0, "", "", 0.6796116504854369], ["West", "Pear", "", 1.0, "", 0.32038834951456313], ["West", "", 0.25830258302583026, 0.4520547945205479, "", 0.2654639175257732], ["Grand Total", "", 1.0, 1.0, 1.0, 1.0]], false],
  ];
  const round = (rows: Value[][]) => rows.map((r) => r.map((v) => (typeof v === "number" ? Number(v.toPrecision(13)) : v)));
  for (const [formula, expected, cut] of blocks) {
    it(formula, () => {
      const got = round(result(formula));
      expect(cut ? got.slice(0, expected.length) : got).toEqual(round(expected));
    });
  }
});
