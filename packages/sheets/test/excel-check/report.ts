import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { attr, child, childrenNamed, parseXml, textOf, type XmlElement } from "@pli.dev/core";
import { fromXlsx, parseFormula, printFormula, toXlsx } from "../../src";
import { resolve } from "../../src/xlsx-chart";
import { lintPackage } from "./lint";
import { featureCounts, type Sample } from "./samples";

/** Looks at a file that Excel (or Google Sheets) saved back, and says what differs from the one Pli wrote. */
export interface Report {
  /** The lines of the report, as Markdown. */
  lines: string[];
  /** How many things need a look. */
  problems: number;
}

/** A formula as it compares: functions' names in one case, `TRUE()` as `TRUE`, and a table's own name left off its columns. */
const normal = (f: string, tables: readonly string[]): string => {
  let text = f.replace(/_xlfn\.(_xlws\.)?/gi, "");
  if (tables.length) text = text.replace(new RegExp(`\\b(${tables.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=\\[)`, "gi"), "");
  try {
    text = printFormula(parseFormula(text));
  } catch {
    // compared as it is
  }
  return text.replace(/\b(TRUE|FALSE)\(\)/gi, "$1").toUpperCase();
};

/** The cells of every sheet, with the value the file caches for them: where Excel put an error, or the text of a check. */
function cached(bytes: Uint8Array): { sheet: string; ref: string; type: string; value: string; formula: string }[] {
  const files = unzipSync(bytes);
  const xml = (p: string): XmlElement | undefined => (files[p] ? parseXml(strFromU8(files[p]!)) : undefined);
  const book = xml("xl/workbook.xml");
  const rels = childrenNamed(xml("xl/_rels/workbook.xml.rels"), "Relationship");
  const strings = childrenNamed(xml("xl/sharedStrings.xml"), "si").map((si) => textOf(si));
  const out: { sheet: string; ref: string; type: string; value: string; formula: string }[] = [];
  for (const s of childrenNamed(child(book, "sheets"), "sheet")) {
    const rel = rels.find((r) => r.attrs["Id"] === attr(s, "id", "r"));
    const root = rel ? xml(resolve("xl/workbook.xml", rel.attrs["Target"] ?? "")) : undefined;
    for (const row of childrenNamed(child(root, "sheetData"), "row"))
      for (const c of childrenNamed(row, "c")) {
        // A picture placed in a cell is stored by Excel as the error #VALUE! with a `vm` (rich value) number: that is the picture, not an error.
        const t = c.attrs["vm"] !== undefined && c.attrs["t"] === "e" ? "picture" : c.attrs["t"] ?? "n";
        const v = textOf(child(c, "v"));
        out.push({ sheet: s.attrs["name"] ?? "", ref: c.attrs["r"] ?? "", type: t, value: t === "s" ? strings[Number(v)] ?? "" : t === "inlineStr" ? textOf(child(c, "is")) : v, formula: textOf(child(c, "f")) });
      }
  }
  return out;
}

export function checkReturned(sample: Sample, bytes: Uint8Array): Report {
  const lines: string[] = [`## ${sample.file}: ${sample.title}`, ""];
  let problems = 0;
  const flag = (m: string) => {
    problems++;
    lines.push(`- **Look at this:** ${m}`);
  };
  const note = (m: string) => lines.push(`- ${m}`);

  // What the program that saved the file did to the package is its own business, but worth a line if Excel is the one that did it.
  for (const p of lintPackage(bytes)) note(`the package as it came back: ${p}`);

  const original = sample.build();
  const want = featureCounts(original.state);
  let got: ReturnType<typeof fromXlsx>;
  try {
    got = fromXlsx(bytes);
  } catch (e) {
    flag(`Pli could not read the file: ${(e as Error).message}`);
    return { lines: [...lines, ""], problems };
  }
  const have = featureCounts(got.workbook);
  for (const key of Object.keys(want)) {
    // Formulas are compared one by one below; a program that stores an array formula in every cell it fills counts more of them.
    if (want[key] === have[key] || key === "formulas") continue;
    // A "Read me" sheet and a filter or sort Pli hid rows for come back as they are; anything else that changes is worth knowing.
    flag(`${key}: Pli wrote ${want[key]}, the file has ${have[key]}`);
  }
  if (!problems) note(`everything Pli wrote is still there: ${Object.entries(have).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ")}`);
  for (const w of got.warnings) flag(`Pli read the file and warned: ${w}`);

  // Excel's own verdicts are in the file: its cached results.
  const cells = cached(bytes);
  const errors = cells.filter((c) => c.type === "e");
  if (errors.length) {
    flag(`${errors.length} cell${errors.length === 1 ? "" : "s"} hold an error as the program that saved the file worked it out: ${errors.slice(0, 12).map((c) => `${c.sheet}!${c.ref} ${c.value}`).join(", ")}${errors.length > 12 ? ", …" : ""}`);
  }
  const checks = cells.filter((c) => c.sheet === "Formulas" && /^D\d+$/.test(c.ref) && c.ref !== "D1");
  if (checks.length) {
    const different = checks.filter((c) => c.value === "DIFFERENT");
    const wrong = checks.filter((c) => c.value === "ERROR");
    note(`self-check: ${checks.filter((c) => c.value === "ok").length} of ${checks.length} formulas gave the same result in Excel as in Pli`);
    for (const c of [...different, ...wrong].slice(0, 40)) {
      const row = c.ref.slice(1);
      const formula = cells.find((x) => x.sheet === "Formulas" && x.ref === `B${row}`);
      const result = cells.find((x) => x.sheet === "Formulas" && x.ref === `C${row}`)?.value;
      flag(`${c.value}: =${formula?.formula ?? "?"}, Excel got ${cells.find((x) => x.sheet === "Formulas" && x.ref === `B${row}`)?.value ?? "?"}, Pli says ${result}`);
    }
    if (!checks.length) flag("the Formulas sheet has no check column: was it saved as something other than .xlsx?");
  }

  // Formulas that came back different from what Pli wrote.
  const changed: string[] = [];
  const tableNames = original.state.sheets.flatMap((sh) => (sh.tables ?? []).map((t) => t.name));
  for (const sheet of original.state.sheets) {
    const back = got.workbook.sheets.find((s) => s.name === sheet.name);
    if (!back) {
      flag(`the sheet "${sheet.name}" is gone`);
      continue;
    }
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (cell.f === undefined) continue;
      const f = back.cells[address]?.f;
      if (f === undefined) changed.push(`${sheet.name}!${address} lost its formula`);
      else if (normal(f, tableNames) !== normal(cell.f, tableNames)) changed.push(`${sheet.name}!${address}: wrote =${cell.f}, came back =${f}`);
    }
  }
  if (changed.length) {
    lines.push(`- ${changed.length} formula${changed.length === 1 ? "" : "s"} came back written differently (often harmless: Excel rewrites some forms):`);
    for (const c of changed.slice(0, 15)) lines.push(`  - ${c}`);
  }
  lines.push("");
  return { lines, problems };
}

/** The file Pli writes for a sample. */
export const written = (sample: Sample): Uint8Array => {
  const bytes = toXlsx(sample.build().state, { now: () => 45_000.5 });
  if (!sample.patch) return bytes;
  const files = unzipSync(bytes);
  sample.patch(files);
  return zipSync(files);
};
