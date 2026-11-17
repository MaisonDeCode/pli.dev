import { attr, child, childrenNamed, textOf, type XmlElement } from "@pli.dev/core";
import { colName, colNumber } from "./address";
import { sheetRef } from "./formula";
import { MAX_COLS, MAX_ROWS, type HeaderFooterParts, type PageSetup, type PaperSize, type Sheet } from "./model";
import { DEFAULT_MARGINS, PAPER_SIZES, cleanPageSetup, marginsOf } from "./page";

/*
 * How a sheet prints, in an .xlsx file: `pageSetup` (paper, orientation, scale or fit), `pageMargins`, `printOptions`,
 * `headerFooter` (the text with Excel's `&L`, `&C` and `&R` for its three parts), `rowBreaks` and `colBreaks`, a `fitToPage`
 * flag in `sheetPr`, and the workbook's defined names `_xlnm.Print_Area` and `_xlnm.Print_Titles`, one for each sheet.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
/** Escapes text that goes between tags, where quotes are fine as they are (Excel writes `&amp;"Arial,Bold"`). */
const escText = (s: string) => esc(s).replace(/&quot;/g, '"');
const truthy = (v: string | undefined) => v === "1" || v === "true";
const PAPER_BY_CODE = new Map(Object.entries(PAPER_SIZES).map(([name, p]) => [p.code, name as PaperSize]));

/** The `<pageSetUpPr>` that tells Excel to fit the sheet to pages, for `sheetPr`. */
export const pageSetUpPrXml = (page: PageSetup | undefined): string => (page?.fit ? '<pageSetUpPr fitToPage="1"/>' : "");

const section = (text: string | undefined, code: string) => (text ? `&${code}${text}` : "");
const joined = (p: HeaderFooterParts | undefined) => (p ? section(p.left, "L") + section(p.center, "C") + section(p.right, "R") : "");

/** Everything in a worksheet that says how it prints, in the order the schema wants it (after the hyperlinks, before the drawing). */
export function pageXml(page: PageSetup | undefined): string {
  if (!page) return "";
  const m = marginsOf(page);
  const flags = [page.centerHorizontally ? 'horizontalCentered="1"' : "", page.centerVertically ? 'verticalCentered="1"' : "", page.headings ? 'headings="1"' : "", page.gridlines ? 'gridLines="1"' : ""].filter(Boolean);
  const printOptions = flags.length ? `<printOptions ${flags.join(" ")}/>` : "";
  const margins = `<pageMargins left="${m.left}" right="${m.right}" top="${m.top}" bottom="${m.bottom}" header="${m.header}" footer="${m.footer}"/>`;
  const setup = [
    `paperSize="${PAPER_SIZES[page.paper ?? "letter"].code}"`,
    page.scale ? `scale="${page.scale}"` : "",
    page.fit ? `fitToWidth="${page.fit.wide}" fitToHeight="${page.fit.tall}"` : "",
    page.firstPageNumber !== undefined ? `firstPageNumber="${page.firstPageNumber}" useFirstPageNumber="1"` : "",
    page.order === "over" ? 'pageOrder="overThenDown"' : "",
    page.blackAndWhite ? 'blackAndWhite="1"' : "",
    page.draft ? 'draft="1"' : "",
    page.comments ? `cellComments="${page.comments === "end" ? "atEnd" : "asDisplayed"}"` : "",
    page.errors ? `errors="${page.errors === "na" ? "NA" : page.errors}"` : "",
    `orientation="${page.orientation === "landscape" ? "landscape" : "portrait"}"`,
  ].filter(Boolean);
  const pageSetup = `<pageSetup ${setup.join(" ")}/>`;
  const parts: [string, HeaderFooterParts | undefined][] = [["oddHeader", page.header], ["oddFooter", page.footer], ["evenHeader", page.evenHeader], ["evenFooter", page.evenFooter], ["firstHeader", page.firstHeader], ["firstFooter", page.firstFooter]];
  const texts = parts.map(([tag, p]) => (joined(p) ? `<${tag}>${escText(joined(p))}</${tag}>` : "")).join("");
  const headerFooter = texts ? `<headerFooter${page.differentOddEven ? ' differentOddEven="1"' : ""}${page.differentFirstPage ? ' differentFirst="1"' : ""}>${texts}</headerFooter>` : "";
  const brk = (list: number[] | undefined, tag: string, max: number) => (list?.length ? `<${tag} count="${list.length}" manualBreakCount="${list.length}">${list.map((n) => `<brk id="${n}" max="${max}" man="1"/>`).join("")}</${tag}>` : "");
  return printOptions + margins + pageSetup + headerFooter + brk(page.rowBreaks, "rowBreaks", MAX_COLS - 1) + brk(page.colBreaks, "colBreaks", MAX_ROWS - 1);
}

/** The defined names that carry a sheet's print area and titles. `index` is the sheet's place in the workbook. */
export function printNamesXml(sheet: Sheet, index: number): string {
  const p = sheet.page;
  if (!p) return "";
  const name = sheetRef(sheet.name);
  const out: string[] = [];
  if (p.printArea?.length) out.push(`<definedName name="_xlnm.Print_Area" localSheetId="${index}">${esc(p.printArea.map((r) => `${name}!${r.split(":").map((c) => c.replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2")).join(":")}`).join(","))}</definedName>`);
  const titles = [p.titleCols ? `${name}!$${colName(p.titleCols[0])}:$${colName(p.titleCols[1])}` : "", p.titleRows ? `${name}!$${p.titleRows[0]}:$${p.titleRows[1]}` : ""].filter(Boolean);
  if (titles.length) out.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${index}">${esc(titles.join(","))}</definedName>`);
  return out.join("");
}

// ---- reading ----

/** Splits the text of a header or footer into its left, middle and right parts. */
function splitParts(text: string): HeaderFooterParts {
  const out: Record<string, string> = { L: "", C: "", R: "" };
  // Text before any section code is the middle, as Excel reads it.
  let at = "C";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch !== "&") {
      out[at] += ch;
      continue;
    }
    const next = text[i + 1];
    if (next === "L" || next === "C" || next === "R") {
      at = next;
      i++;
    } else if (next === "&") {
      out[at] += "&&";
      i++;
    } else if (next === '"') {
      const end = text.indexOf('"', i + 2);
      const stop = end < 0 ? text.length : end;
      out[at] += text.slice(i, stop + 1);
      i = stop;
    } else if (next !== undefined) {
      out[at] += `&${next}`;
      i++;
    }
  }
  return { ...(out["L"] ? { left: out["L"] } : {}), ...(out["C"] ? { center: out["C"] } : {}), ...(out["R"] ? { right: out["R"] } : {}) };
}

/** Reads how a worksheet prints onto its sheet. Print areas and titles come from the workbook's names (`readPrintNames`). */
export function readPage(root: XmlElement, sheet: Sheet, warnings: Set<string>): void {
  const setup = child(root, "pageSetup");
  const margins = child(root, "pageMargins");
  const options = child(root, "printOptions");
  const hf = child(root, "headerFooter");
  const fitToPage = truthy(attr(child(child(root, "sheetPr"), "pageSetUpPr"), "fitToPage"));
  const rowBreaks = childrenNamed(child(root, "rowBreaks"), "brk");
  const colBreaks = childrenNamed(child(root, "colBreaks"), "brk");
  if (!setup && !margins && !options && !hf && !rowBreaks.length && !colBreaks.length) return;
  const page: Record<string, unknown> = {};
  if (attr(setup, "orientation") === "landscape") page["orientation"] = "landscape";
  const code = Number(attr(setup, "paperSize") ?? 1);
  const paper = PAPER_BY_CODE.get(code);
  if (paper) page["paper"] = paper;
  else if (setup && attr(setup, "paperSize")) warnings.add(`A sheet is set to a paper size Pli doesn't have (code ${code}), so it prints on letter paper`);
  if (fitToPage) page["fit"] = { wide: Number(attr(setup, "fitToWidth") ?? 1), tall: Number(attr(setup, "fitToHeight") ?? 1) };
  else if (attr(setup, "scale")) page["scale"] = Number(attr(setup, "scale"));
  if (truthy(attr(setup, "useFirstPageNumber")) && attr(setup, "firstPageNumber")) page["firstPageNumber"] = Number(attr(setup, "firstPageNumber"));
  if (attr(setup, "pageOrder") === "overThenDown") page["order"] = "over";
  if (truthy(attr(setup, "blackAndWhite"))) page["blackAndWhite"] = true;
  if (truthy(attr(setup, "draft"))) page["draft"] = true;
  const comments = attr(setup, "cellComments");
  if (comments === "atEnd") page["comments"] = "end";
  else if (comments === "asDisplayed") page["comments"] = "sheet";
  const errors = attr(setup, "errors");
  if (errors === "blank" || errors === "dash") page["errors"] = errors;
  else if (errors === "NA") page["errors"] = "na";
  if (margins) {
    const m: Record<string, number> = {};
    for (const k of Object.keys(DEFAULT_MARGINS)) {
      const v = Number(attr(margins, k));
      if (attr(margins, k) !== undefined && Number.isFinite(v)) m[k] = v;
    }
    page["margins"] = m;
  }
  if (truthy(attr(options, "horizontalCentered"))) page["centerHorizontally"] = true;
  if (truthy(attr(options, "verticalCentered"))) page["centerVertically"] = true;
  if (truthy(attr(options, "headings"))) page["headings"] = true;
  if (truthy(attr(options, "gridLines"))) page["gridlines"] = true;
  if (hf) {
    if (truthy(attr(hf, "differentFirst"))) page["differentFirstPage"] = true;
    if (truthy(attr(hf, "differentOddEven"))) page["differentOddEven"] = true;
    for (const [tag, key] of [["oddHeader", "header"], ["oddFooter", "footer"], ["evenHeader", "evenHeader"], ["evenFooter", "evenFooter"], ["firstHeader", "firstHeader"], ["firstFooter", "firstFooter"]] as const) {
      const text = textOf(child(hf, tag));
      if (text) page[key] = splitParts(text);
    }
  }
  const ids = (list: XmlElement[]) => list.map((b) => Number(attr(b, "id"))).filter((n) => Number.isInteger(n) && n >= 1);
  if (rowBreaks.length) page["rowBreaks"] = ids(rowBreaks).filter((n) => n < MAX_ROWS);
  if (colBreaks.length) page["colBreaks"] = ids(colBreaks).filter((n) => n < MAX_COLS);
  try {
    const clean = cleanPageSetup(page as PageSetup);
    if (clean) sheet.page = clean;
  } catch (e) {
    warnings.add(`How "${sheet.name}" prints could not be read (${(e as Error).message}), so it prints with the defaults`);
  }
}

const REF = /(?:'((?:[^']|'')+)'|([^',!]+))!([^,]+)/g;

/** The parts of a print name: the sheet each is on, and the reference. */
function pieces(text: string): { sheet: string; ref: string }[] {
  return [...text.matchAll(REF)].map((m) => ({ sheet: (m[1] ?? m[2])!.replace(/''/g, "'"), ref: m[3]!.replace(/\$/g, "").toUpperCase() }));
}

/** Reads `_xlnm.Print_Area` and `_xlnm.Print_Titles` onto the sheet they belong to. `sheetAt` finds a sheet by its place in the file. */
export function readPrintNames(book: XmlElement | undefined, sheetAt: (index: number) => Sheet | undefined, warnings: Set<string>): void {
  for (const n of childrenNamed(child(book, "definedNames"), "definedName")) {
    const name = attr(n, "name");
    if (name !== "_xlnm.Print_Area" && name !== "_xlnm.Print_Titles") continue;
    const sheet = sheetAt(Number(attr(n, "localSheetId")));
    if (!sheet) continue;
    const page: Record<string, unknown> = { ...sheet.page };
    for (const { ref } of pieces(textOf(n))) {
      const cols = /^([A-Z]{1,3}):([A-Z]{1,3})$/.exec(ref);
      const rows = /^(\d+):(\d+)$/.exec(ref);
      if (name === "_xlnm.Print_Titles") {
        if (cols) page["titleCols"] = [colNumber(cols[1]!), colNumber(cols[2]!)];
        else if (rows) page["titleRows"] = [Number(rows[1]), Number(rows[2])];
      } else {
        const area = cols ? `${cols[1]}1:${cols[2]}${MAX_ROWS}` : rows ? `A${rows[1]}:${colName(MAX_COLS)}${rows[2]}` : ref;
        (page["printArea"] ??= [] as string[]) as string[];
        (page["printArea"] as string[]).push(area);
      }
    }
    try {
      const clean = cleanPageSetup(page as PageSetup);
      if (clean) sheet.page = clean;
    } catch {
      warnings.add(`The print area or titles of "${sheet.name}" could not be read, so they are left out`);
    }
  }
}
