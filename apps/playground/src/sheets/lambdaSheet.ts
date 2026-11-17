import type { SheetSession } from "@pli.dev/sheets";

const SHEET = "Lambda";
const CODE = { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 10, color: "#3730a3" } as const;

/**
 * A sheet that explains LET and LAMBDA by example. Every example is a live formula with the formula itself shown above it
 * (by FORMULATEXT, so it can't drift), and the data they work on is on the right, so changing a number shows what happens.
 */
export function fillLambdaSheet(s: SheetSession): void {
  const set = (address: string, value: string | number | null) => s.setCell(SHEET, address, value);

  // The data the examples use.
  s.setValues(SHEET, "H1", [
    ["Item", "Price", "Qty"],
    ["Standing desk", 489, 4],
    ["Monitor", 329.99, 6],
    ["Ergonomic chair", 259.5, 4],
    ["Webcam", 79, 6],
    ["Headset", 119.95, 8],
    ["Whiteboard", 145, 2],
  ]);
  s.setValues(SHEET, "L1", [
    ["Student", "Test 1", "Test 2", "Test 3"],
    ["Ann", 72, 88, 91],
    ["Bo", 65, 70, 58],
    ["Cy", 90, 94, 99],
    ["Di", 55, 80, 77],
  ]);
  s.setFormat(SHEET, "I2:I7", "$#,##0.00");
  s.setStyle(SHEET, "H1:J1", { bold: true, fill: "#e4e2fb", color: "#3730a3" });
  s.setStyle(SHEET, "L1:O1", { bold: true, fill: "#e4e2fb", color: "#3730a3" });
  set("H9", "The data the examples work on. Change a number and watch the results.");
  s.setStyle(SHEET, "H9", { italic: true, color: "#6b7280" });

  set("A1", "LAMBDA: a function you write yourself");
  s.setStyle(SHEET, "A1:F1", { bold: true, fontSize: 16, fill: "#e4e2fb", color: "#3730a3" });
  set("A2", "A LAMBDA is a recipe with named inputs: LAMBDA(x, x * 2) means \"given x, give back x times 2\".");
  set("A3", "On its own it does nothing. Give it a name with LET, or hand it to MAP, REDUCE and the others, which call it for you.");
  set("A4", "Each example below shows its formula in blue, then the live result. Results that give several values spill into the cells below.");

  let row = 6;
  /** One example: a heading, what it shows, the formula as written, and the live formula (with room below for what it fills). */
  const example = (title: string, about: string, formula: string, room = 1) => {
    set(`A${row}`, title);
    s.setStyle(SHEET, `A${row}:F${row}`, { bold: true, fill: "#f3f4f6" });
    set(`A${row + 1}`, about);
    set(`A${row + 2}`, `=FORMULATEXT(B${row + 3})`);
    s.setStyle(SHEET, `A${row + 2}`, CODE);
    set(`A${row + 3}`, "Result");
    s.setStyle(SHEET, `A${row + 3}`, { color: "#6b7280", align: "right" });
    set(`B${row + 3}`, formula);
    s.setStyle(SHEET, `B${row + 3}`, { bold: true });
    row += 4 + room + 1;
  };

  example(
    "1. LET: give a value a name",
    "LET(name, value, …, result). A name can use the ones before it. Here, a price with tax, written once and used once.",
    "=LET(price, I2, rate, 0.08, price * (1 + rate))",
  );
  example(
    "2. A LAMBDA with a name",
    "LAMBDA(input, what to work out). LET names it, and then you call it like any function. Here it is called twice.",
    "=LET(addTax, LAMBDA(p, p * 1.08), addTax(I2) + addTax(I3))",
  );
  example(
    "3. More than one input",
    "List the inputs before the calculation: LAMBDA(width, height, width * height).",
    "=LET(area, LAMBDA(w, h, w * h), area(3, 4))",
  );
  example(
    "4. MAP: do something to every item",
    "MAP(array, LAMBDA(x, …)) calls the LAMBDA for each item and gives the results as an array, which spills.",
    "=MAP(I2:I7, LAMBDA(p, p * 1.08))",
    6,
  );
  example(
    "5. MAP with two arrays",
    "Give MAP two ranges and the LAMBDA two inputs: it takes one item from each, side by side. Here, price times quantity.",
    "=MAP(I2:I7, J2:J7, LAMBDA(p, q, p * q))",
    6,
  );
  example(
    "6. REDUCE: boil a list down to one value",
    "REDUCE(start, array, LAMBDA(running, item, …)) goes through the items, carrying a running value. This adds them up; SUM does the same.",
    "=REDUCE(0, I2:I7, LAMBDA(total, p, total + p))",
  );
  example(
    "7. REDUCE with something SUM can't do",
    "The running value can be text. This joins the names with commas, starting with the first.",
    '=REDUCE("", H2:H7, LAMBDA(list, name, IF(list = "", name, list & ", " & name)))',
  );
  example(
    "8. SCAN: show every step of a REDUCE",
    "SCAN is REDUCE that keeps each running value. This is a running total of the prices.",
    "=SCAN(0, I2:I7, LAMBDA(total, p, total + p))",
    6,
  );
  example(
    "9. BYROW and BYCOL: one answer for each row or column",
    "BYROW hands the LAMBDA a whole row at a time. This gives each student's best test (the table is on the right).",
    "=BYROW(M2:O5, LAMBDA(scores, MAX(scores)))",
    4,
  );
  example(
    "10. BYCOL",
    "The same for columns: the class average for each test, in a row.",
    "=BYCOL(M2:O5, LAMBDA(test, AVERAGE(test)))",
  );
  example(
    "11. MAKEARRAY: build a grid from nothing",
    "MAKEARRAY(rows, columns, LAMBDA(row, column, …)) calls the LAMBDA for each position. A multiplication table.",
    "=MAKEARRAY(5, 5, LAMBDA(r, c, r * c))",
    5,
  );
  example(
    "12. A LAMBDA passed by name",
    "Name it once with LET, then give the name to MAP. A discount of 10% on anything over $100.",
    "=LET(discount, LAMBDA(p, IF(p > 100, p * 0.9, p)), MAP(I2:I7, discount))",
    6,
  );

  set(`A${row}`, "Good to know");
  s.setStyle(SHEET, `A${row}:F${row}`, { bold: true, fill: "#f3f4f6" });
  [
    "• The inputs are only names: p, total and x mean nothing special, so choose ones that read well.",
    "• A LAMBDA can use the names LET made before it, as well as its own inputs.",
    "• A LAMBDA must be named (LET) or handed to MAP, REDUCE and the others. LAMBDA(x, x + 1)(5) isn't supported; write LET(f, LAMBDA(x, x + 1), f(5)).",
    "• If a spilled result has something in its way, the formula shows #SPILL! until you clear the cells.",
  ].forEach((t, i) => set(`A${row + 1 + i}`, t));

  s.setColumnWidth(SHEET, 1, 46);
  for (const c of [2, 3, 4, 5, 6]) s.setColumnWidth(SHEET, c, 12);
  s.setColumnWidth(SHEET, 7, 4);
  s.setColumnWidth(SHEET, 8, 18);
  s.setColumnWidth(SHEET, 9, 10);
  s.setColumnWidth(SHEET, 10, 6);
  s.setColumnWidth(SHEET, 11, 4);
  s.setColumnWidth(SHEET, 12, 10);
  for (const c of [13, 14, 15]) s.setColumnWidth(SHEET, c, 8);
}
