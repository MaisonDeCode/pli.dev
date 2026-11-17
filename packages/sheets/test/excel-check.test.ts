import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { fromXlsx } from "../src";
import { lintPackage } from "./excel-check/lint";
import { checkReturned, written } from "./excel-check/report";
import { SAMPLES } from "./excel-check/samples";

/**
 * The files to open in real Excel and Google Sheets (`pnpm excel-check:make` writes them to `excel-check/`), the check of
 * what comes back (`pnpm excel-check:read`), and, always, a check that what Pli writes isn't broken in the ways Excel
 * minds and LibreOffice doesn't.
 */
const OUT = join(__dirname, "..", "..", "..", "excel-check");

describe("the files Pli writes for Excel", () => {
  for (const sample of SAMPLES) {
    it(`${sample.file} is a sound package that Pli reads back without a warning`, () => {
      const bytes = written(sample);
      expect(lintPackage(bytes).filter((p) => !sample.expected?.test(p))).toEqual([]);
      const back = fromXlsx(bytes);
      expect(back.warnings.filter((w) => !sample.expected?.test(w))).toEqual([]);
    });
  }

  it("has a Read me sheet first in every file, saying what to look for", () => {
    for (const sample of SAMPLES) {
      const s = sample.build();
      expect(s.state.sheets[0]!.name).toBe("Read me");
      expect(s.value("Read me", "A3")).toMatch(/^1\. /);
      expect(sample.see.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("the package check itself", () => {
  const base = () => unzipSync(written(SAMPLES.find((s) => s.file === "06-tables.xlsx")!));
  const edit = (files: Record<string, Uint8Array>, path: string, fn: (text: string) => string) => ({ ...files, [path]: strToU8(fn(strFromU8(files[path]!))) });
  const problems = (files: Record<string, Uint8Array>) => lintPackage(zipSync(files));

  it("passes a file Pli wrote", () => {
    expect(problems(base())).toEqual([]);
  });

  it("notices a relationship that leads nowhere, a part with no content type, and one that isn't listed", () => {
    const files = base();
    const noTable = { ...files };
    delete noTable["xl/tables/table1.xml"];
    expect(problems(noTable).join("\n")).toMatch(/table1\.xml, which isn't in the package/);
    expect(problems(edit(files, "[Content_Types].xml", (t) => t.replace(/<Override PartName="\/xl\/tables\/table1\.xml"[^>]*\/>/, ""))).join("\n")).toMatch(/table1\.xml: content type is/);
    expect(problems(edit(files, "[Content_Types].xml", (t) => t.replace("</Types>", '<Override PartName="/xl/nothing.xml" ContentType="application/xml"/></Types>'))).join("\n")).toMatch(/xl\/nothing\.xml, which isn't/);
  });

  it("notices a table whose columns don't match its header cells, and sheet elements out of order", () => {
    const files = base();
    expect(problems(edit(files, "xl/tables/table1.xml", (t) => t.replace('name="Region"', 'name="Area"'))).join("\n")).toMatch(/column "Area" but its header cell A1 says "Region"/);
    expect(problems(edit(files, "xl/worksheets/sheet2.xml", (t) => t.replace(/(<tableParts[^>]*>.*<\/tableParts>)/s, "").replace("<sheetData>", "<tableParts count=\"0\"></tableParts><sheetData>"))).join("\n")).toMatch(/comes after/);
  });

  it("notices counts that don't add up, and a style that isn't there", () => {
    const files = base();
    expect(problems(edit(files, "xl/styles.xml", (t) => t.replace(/<fonts count="\d+"/, '<fonts count="99"'))).join("\n")).toMatch(/fonts count="99"/);
    expect(problems(edit(files, "xl/worksheets/sheet1.xml", (t) => t.replace(/ s="\d+"/, ' s="999"'))).join("\n")).toMatch(/uses style 999/);
  });

  it("notices a note without its box, and a picture whose file is gone", () => {
    const withNotes = unzipSync(written(SAMPLES.find((s) => s.file === "08-links-and-notes.xlsx")!));
    expect(problems(edit(withNotes, "xl/drawings/vmlDrawing1.vml", (t) => t.replace(/<v:shape [\s\S]*?<\/v:shape>/, ""))).join("\n")).toMatch(/note boxes for/);
    const withPictures = unzipSync(written(SAMPLES.find((s) => s.file === "09-pictures.xlsx")!));
    const lost = { ...withPictures };
    delete lost["xl/media/image1.png"];
    expect(problems(lost).join("\n")).toMatch(/image1\.png, which isn't in the package/);
  });
});

describe("the package check, on pivot tables", () => {
  const pivots = () => unzipSync(written(SAMPLES.find((s) => s.file === "15-pivot-tables.xlsx")!));
  const edit = (files: Record<string, Uint8Array>, path: string, fn: (text: string) => string) => ({ ...files, [path]: strToU8(fn(strFromU8(files[path]!))) });
  const problems = (files: Record<string, Uint8Array>) => lintPackage(zipSync(files)).join("\n");

  it("passes the pivot tables Pli wrote, and notices the mistakes Excel would repair", () => {
    const files = pivots();
    expect(problems(files)).toBe("");
    expect(problems(edit(files, "xl/pivotTables/pivotTable1.xml", (t) => t.replace(/<rowItems count="\d+"/, '<rowItems count="99"')))).toMatch(/rowItems.*count="99"/);
    expect(problems(edit(files, "xl/pivotTables/pivotTable1.xml", (t) => t.replace(/cacheId="1"/, 'cacheId="7"')))).toMatch(/cacheId 7 isn't one of/);
    expect(problems(edit(files, "xl/pivotTables/pivotTable1.xml", (t) => t.replace('name="Sum of Amount"', 'name="Amount"')))).toMatch(/has the name of a source field/);
    expect(problems(edit(files, "xl/pivotTables/pivotTable1.xml", (t) => t.replace(/<location ref="[A-Z]+\d+:[A-Z]+\d+"/, '<location ref="A1:C3"')))).toMatch(/rowItems lists \d+ rows/);
    expect(problems(edit(files, "xl/pivotCache/pivotCacheDefinition1.xml", (t) => t.replace(/<sharedItems count="3">/, '<sharedItems count="9">')))).toMatch(/says 9 shared items/);
    const lost = { ...files };
    delete lost["xl/pivotCache/pivotCacheDefinition1.xml"];
    expect(problems(lost)).toMatch(/pivotCacheDefinition1\.xml, which isn't in the package/);
  });
});

describe("the package check, on pictures that are cropped, turned and follow their cells", () => {
  const files = () => unzipSync(written(SAMPLES.find((s) => s.file === "19-pictures-more.xlsx")!));
  const edit = (f: Record<string, Uint8Array>, path: string, fn: (text: string) => string) => ({ ...f, [path]: strToU8(fn(strFromU8(f[path]!))) });
  const problems = (f: Record<string, Uint8Array>) => lintPackage(zipSync(f)).join("\n");
  const drawings = () => Object.keys(files()).filter((k) => /xl\/drawings\/drawing\d+\.xml$/.test(k));

  it("passes what Pli wrote, which has a crop, a turn, a flip, all three anchors", () => {
    const f = files();
    expect(problems(f)).toBe("");
    const xml = drawings().map((d) => strFromU8(f[d]!)).join("\n");
    expect(xml).toContain("<a:srcRect");
    expect(xml).toContain('rot="1800000"');
    expect(xml).toContain('flipH="1"');
    expect(xml).toContain("<xdr:oneCellAnchor>");
    expect(xml).toContain('editAs="twoCell"');
    expect(xml).toContain('editAs="absolute"');
  });

  it("notices a crop that cuts everything, a turn that isn't a turn, and an anchor that ends before it starts", () => {
    const f = files();
    const d = drawings().find((n) => strFromU8(f[n]!).includes("srcRect"))!;
    expect(problems(edit(f, d, (t) => t.replace(/<a:srcRect l="\d+" t="\d+"\/>/, '<a:srcRect l="60000" r="50000"/>')))).toMatch(/cuts off the whole picture/);
    expect(problems(edit(f, d, (t) => t.replace('rot="1800000"', 'rot="99999999"')))).toMatch(/rotation/);
    expect(problems(edit(f, d, (t) => t.replace('editAs="twoCell"', 'editAs="sideways"')))).toMatch(/editAs="sideways"/);
    expect(problems(edit(f, d, (t) => t.replace(/<xdr:to><xdr:col>\d+<\/xdr:col>/, "<xdr:to><xdr:col>0</xdr:col>")))).toMatch(/ends .* before it starts/);
  });

  it("keeps the pictures through a write and a read", () => {
    const wb = fromXlsx(written(SAMPLES.find((s) => s.file === "19-pictures-more.xlsx")!)).workbook;
    const [, pics, cells] = wb.sheets;
    expect(pics!.images).toHaveLength(9);
    expect(cells!.cells["B2"]!.picture).toBeDefined();
    expect(cells!.cells["B4"]!.picture).toBeDefined();
    expect(cells!.cells["A2"]!.f).toContain("IMAGE(");
    expect(pics!.images!.map((i) => i.placement ?? "move")).toEqual(["move", "move", "move", "size", "move", "free", "move", "move", "move"]);
  });
});

describe("the package check, on pictures placed in cells", () => {
  const files = () => unzipSync(written(SAMPLES.find((s) => s.file === "19-pictures-more.xlsx")!));
  const edit = (f: Record<string, Uint8Array>, path: string, fn: (text: string) => string) => ({ ...f, [path]: strToU8(fn(strFromU8(f[path]!))) });
  const problems = (f: Record<string, Uint8Array>) => lintPackage(zipSync(f)).join("\n");

  it("passes what Pli wrote", () => {
    expect(Object.keys(files())).toContain("xl/metadata.xml");
    expect(problems(files())).toBe("");
  });

  it("notices a chain of numbers that leads nowhere", () => {
    const f = files();
    expect(problems(edit(f, "xl/metadata.xml", (t) => t.replace('<rc t="1" v="0"/>', '<rc t="1" v="9"/>')))).toMatch(/points at future metadata 9/);
    expect(problems(edit(f, "xl/metadata.xml", (t) => t.replace('<xlrd:rvb i="0"/>', '<xlrd:rvb i="9"/>')))).toMatch(/rich value 9/);
    expect(problems(edit(f, "xl/richData/rdrichvalue.xml", (t) => t.replace(/<rv s="\d"><v>\d+<\/v>/, '<rv s="7"><v>0</v>')))).toMatch(/structure 7/);
    expect(problems(edit(f, "xl/richData/rdrichvalue.xml", (t) => t.replace(/<rv s="(\d)"><v>\d+<\/v>/, '<rv s="$1"><v>8</v>')))).toMatch(/names picture 8/);
    expect(problems(edit(f, "xl/richData/rdrichvalue.xml", (t) => t.replace(/<v>5<\/v>/, "")))).toMatch(/values and its structure/);
    expect(problems(edit(f, "xl/worksheets/sheet3.xml", (t) => t.replace('vm="1"', 'vm="9"')))).toMatch(/vm="9"/);
  });
});

describe("the package check, on iterative calculation", () => {
  const files = () => unzipSync(written(SAMPLES.find((s) => s.file === "18-iteration.xlsx")!));
  const edit = (f: Record<string, Uint8Array>, path: string, fn: (text: string) => string) => ({ ...f, [path]: strToU8(fn(strFromU8(f[path]!))) });
  const problems = (f: Record<string, Uint8Array>) => lintPackage(zipSync(f)).join("\n");

  it("passes what Pli wrote, which turns iteration on in calcPr", () => {
    const f = files();
    expect(problems(f)).toBe("");
    expect(strFromU8(f["xl/workbook.xml"]!)).toMatch(/<calcPr[^>]*iterate="1" iterateCount="100" iterateDelta="0.001"/);
  });

  it("notices iterate settings that make no sense", () => {
    const f = files();
    expect(problems(edit(f, "xl/workbook.xml", (t) => t.replace('iterateCount="100"', 'iterateCount="0"')))).toMatch(/iterateCount/);
    expect(problems(edit(f, "xl/workbook.xml", (t) => t.replace('iterateDelta="0.001"', 'iterateDelta="-1"')))).toMatch(/iterateDelta/);
    expect(problems(edit(f, "xl/workbook.xml", (t) => t.replace('iterate="1" ', "")))).toMatch(/iterate is not turned on/);
  });

  it("settles to the numbers the sample asks Excel to check", () => {
    const s = SAMPLES.find((x) => x.file === "18-iteration.xlsx")!.build();
    expect(s.values("Loops", "D2:D5")).toEqual([["OK"], ["OK"], ["OK"], ["OK"]]);
  });
});

describe("the package check, on sorted, filtered and compared pivot tables", () => {
  const files = () => unzipSync(written(SAMPLES.find((s) => s.file === "17-pivot-more.xlsx")!));
  const edit = (f: Record<string, Uint8Array>, path: string, fn: (text: string) => string) => ({ ...f, [path]: strToU8(fn(strFromU8(f[path]!))) });
  const problems = (f: Record<string, Uint8Array>) => lintPackage(zipSync(f)).join("\n");
  const names = () => Object.keys(files()).filter((k) => /pivotTables\/pivotTable\d+\.xml$/.test(k));

  it("passes what Pli wrote, which has a sort by a value, a top filter and a difference", () => {
    const f = files();
    expect(problems(f)).toBe("");
    expect(names()).toHaveLength(4);
    const all = names().map((n) => strFromU8(f[n]!)).join("\n");
    expect(all).toContain("<autoSortScope>");
    expect(all).toContain("<top10 val=\"2\" filterVal=\"2\"/>");
    expect(all).toContain('showDataAs="difference"');
  });

  it("notices a sort or a filter by a value that isn't there, and a show-as the format doesn't have", () => {
    const f = files();
    const sorted = names().find((n) => strFromU8(f[n]!).includes("autoSortScope"))!;
    expect(problems(edit(f, sorted, (t) => t.replace('<x v="0"/></reference>', '<x v="5"/></reference>')))).toMatch(/is sorted by data field 5/);
    const filtered = names().find((n) => strFromU8(f[n]!).includes("<filters"))!;
    expect(problems(edit(f, filtered, (t) => t.replace('iMeasureFld="0"', 'iMeasureFld="4"')))).toMatch(/filter is by data field 4/);
    expect(problems(edit(f, filtered, (t) => t.replace('<filters count="1">', '<filters count="3">')))).toMatch(/filters/);
    const compared = names().find((n) => strFromU8(f[n]!).includes("showDataAs"))!;
    expect(problems(edit(f, compared, (t) => t.replace('showDataAs="difference"', 'showDataAs="rankAscending"')))).toMatch(/file format doesn't have/);
  });

  it("works out the GETPIVOTDATA formulas the sample asks Excel to check", () => {
    const s = SAMPLES.find((x) => x.file === "17-pivot-more.xlsx")!.build();
    expect(s.values("Lookups", "B1:B3")).toEqual([[452], [174], [96]]);
    expect(s.values("Pivots", "A3:B6")).toEqual([["South", 180], ["North", 174], ["East", 98], ["Grand Total", 452]]);
  });

  it("has a pivot table where Pli wrote one and plain cells where it couldn't", () => {
    const f = files();
    expect(strFromU8(f["xl/workbook.xml"]!)).toContain("<pivotCaches>");
    const sheetFiles = Object.keys(f).filter((k) => /xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(k));
    // Orders, Pivots, Lookups, Kept as cells: only the Pivots sheet leads to pivot tables.
    expect(sheetFiles.filter((k) => strFromU8(f[k]!).includes("pivotTable"))).toHaveLength(1);
  });
});

describe.skipIf(process.env["PLI_EXCEL_CHECK"] !== "make")("writing the files to open in Excel", () => {
  it("writes them, with the instructions, to excel-check/", () => {
    mkdirSync(join(OUT, "back"), { recursive: true });
    for (const sample of SAMPLES) writeFileSync(join(OUT, sample.file), written(sample));
    writeFileSync(join(OUT, "START-HERE.md"), startHere());
    expect(readdirSync(OUT).filter((f) => f.endsWith(".xlsx"))).toHaveLength(SAMPLES.length);
  });
});

describe.skipIf(process.env["PLI_EXCEL_CHECK"] !== "read")("reading the files that came back", () => {
  it("reports what Excel or Google Sheets kept, and what it said about the formulas", () => {
    const dir = join(OUT, "back");
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".xlsx") && !f.startsWith("~$")) : [];
    const lines = ["# What came back", ""];
    let problems = 0;
    let seen = 0;
    for (const sample of SAMPLES) {
      const file = files.find((f) => f.toLowerCase() === sample.file.toLowerCase()) ?? files.find((f) => f.startsWith(sample.file.slice(0, 2)));
      if (!file) {
        lines.push(`## ${sample.file}`, "", "- not in excel-check/back/ (skipped)", "");
        continue;
      }
      seen++;
      const report = checkReturned(sample, new Uint8Array(readFileSync(join(dir, file))));
      lines.push(...report.lines);
      problems += report.problems;
    }
    lines.push(seen ? `**${problems} thing${problems === 1 ? "" : "s"} to look at in ${seen} file${seen === 1 ? "" : "s"}.**` : "**No files found in excel-check/back/.** Save each file from Excel (File > Save As, same name) into that folder.");
    writeFileSync(join(OUT, "REPORT.md"), lines.join("\n") + "\n");
    console.log("\n" + lines.join("\n"));
    expect(seen).toBeGreaterThan(0);
  });
});

function startHere(): string {
  const out = [
    "# Checking Pli.Sheets files in Excel and Google Sheets",
    "",
    "These files have been opened in Excel for Mac and opened without a repair message; what is left is what its automation can't read (notes, sparklines, pivot tables, how things look) and Google Sheets. These files are one for each kind of thing Pli writes. Each starts with a **Read me** sheet that says what to look for. It takes about twenty minutes.",
    "",
    "## In Excel",
    "",
    "1. Open each `.xlsx` in this folder. **If Excel says \"We found a problem with some content… Do you want us to try to recover?\" write down the file name and what it says in the repair log** (click Yes, then look at \"Removed Part\" or \"Repaired Records\" in the dialog that follows). That is the most useful thing you can tell me.",
    "2. Go through the **Read me** sheet and look for each line. Write down any line that isn't true.",
    "3. Save each file back with **File > Save As**, the same name, into the `back/` folder here (choose the Excel Workbook `.xlsx` type).",
    "",
    "## In Google Sheets",
    "",
    "1. Upload each file (drive.google.com, New > File upload), open it with Google Sheets, and go through the same lines. Some won't apply (slicers, data bars, icon sets: noted in each file).",
    "2. Optional: File > Download > Microsoft Excel (.xlsx), and put the download in `back/` with the file's name followed by `-sheets` (for example `01-formulas-sheets.xlsx`), so it isn't mixed up with the Excel one.",
    "",
    "## Then",
    "",
    "Run this from the Pli folder:",
    "",
    "```bash",
    "pnpm excel-check:read",
    "```",
    "",
    "It reads what is in `back/` and writes `REPORT.md` here: what Pli wrote that is no longer in the file, the results Excel itself worked out for every formula (file 01 compares Excel's answer with Pli's on each row), any cell where Excel stored an error, and which formulas came back written differently.",
    "",
    "## The files",
    "",
  ];
  for (const sample of SAMPLES) {
    out.push(`### ${sample.file}: ${sample.title}`, "", ...sample.see.map((line, i) => `${i + 1}. ${line}`), "");
  }
  return out.join("\n");
}
