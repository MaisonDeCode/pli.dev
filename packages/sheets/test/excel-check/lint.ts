import { strFromU8, unzipSync } from "fflate";
import { attr, child, childrenNamed, elements, parseXml, textOf, type XmlElement } from "@pli.dev/core";
import { resolve } from "../../src/xlsx-chart";
import { lintFormatting } from "./lint-format";

/*
 * A check of an .xlsx package for the mistakes that make Excel say "We found a problem with some content", which a
 * program that reads the file forgivingly (LibreOffice, ours) doesn't notice: parts that aren't listed or aren't there,
 * relationships that lead nowhere, elements in an order the schema doesn't allow, counts that don't add up, a table whose
 * columns disagree with its header cells. It can't say a file opens in Excel; it can say it isn't broken in these ways.
 */

const WORKSHEET_ORDER = ["sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData", "sheetCalcPr", "sheetProtection", "protectedRanges", "scenarios", "autoFilter", "sortState", "dataConsolidate", "customSheetViews", "mergeCells", "phoneticPr", "conditionalFormatting", "dataValidations", "hyperlinks", "printOptions", "pageMargins", "pageSetup", "headerFooter", "rowBreaks", "colBreaks", "customProperties", "cellWatches", "ignoredErrors", "smartTags", "drawing", "legacyDrawing", "legacyDrawingHF", "drawingHF", "picture", "oleObjects", "controls", "webPublishItems", "tableParts", "extLst"];
/** AlternateContent and revisionPtr are what Excel itself adds when it saves; they are never written here. */
const WORKBOOK_ORDER = ["fileVersion", "fileSharing", "workbookPr", "AlternateContent", "revisionPtr", "workbookProtection", "bookViews", "sheets", "functionGroups", "externalReferences", "definedNames", "calcPr", "oleSize", "customWorkbookViews", "pivotCaches", "smartTagPr", "smartTagTypes", "webPublishing", "fileRecoveryPr", "webPublishObjects", "extLst"];
const FONT_ORDER = ["b", "i", "strike", "condense", "extend", "outline", "shadow", "u", "vertAlign", "sz", "color", "name", "family", "charset", "scheme"];
const STYLES_ORDER =["numFmts", "fonts", "fills", "borders", "cellStyleXfs", "cellXfs", "cellStyles", "dxfs", "tableStyles", "colors", "extLst"];
const TABLE_ORDER = ["autoFilter", "sortState", "tableColumns", "tableStyleInfo", "extLst"];

const colNumber = (letters: string) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const parseRef = (ref: string) => {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref);
  return m ? { col: colNumber(m[1]!), row: Number(m[2]) } : null;
};
const parseRange = (ref: string) => {
  const [a, b = a] = ref.split(":");
  const p = parseRef(a!);
  const q = parseRef(b!);
  return p && q ? { r1: p.row, c1: p.col, r2: q.row, c2: q.col } : null;
};

export function lintPackage(data: Uint8Array): string[] {
  const problems: string[] = [];
  const bad = (m: string) => problems.push(m);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch (e) {
    return [`not a zip file: ${(e as Error).message}`];
  }
  const names = Object.keys(files);
  const xmlCache = new Map<string, XmlElement | null>();
  const xml = (path: string): XmlElement | undefined => {
    if (!xmlCache.has(path)) {
      try {
        xmlCache.set(path, files[path] ? parseXml(strFromU8(files[path]!)) : null);
      } catch (e) {
        bad(`${path}: not well-formed XML (${(e as Error).message})`);
        xmlCache.set(path, null);
      }
    }
    return xmlCache.get(path) ?? undefined;
  };
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  for (const d of dup) bad(`${d}: appears twice in the package`);

  // ---- content types ----
  const types = xml("[Content_Types].xml");
  if (!types) bad("[Content_Types].xml is missing");
  const defaults = new Map(childrenNamed(types, "Default").map((d) => [(d.attrs["Extension"] ?? "").toLowerCase(), d.attrs["ContentType"] ?? ""]));
  const overrides = new Map(childrenNamed(types, "Override").map((o) => [(o.attrs["PartName"] ?? "").replace(/^\//, ""), o.attrs["ContentType"] ?? ""]));
  for (const [part] of overrides) if (!files[part]) bad(`[Content_Types].xml: lists ${part}, which isn't in the package`);
  for (const n of names) {
    if (n === "[Content_Types].xml" || n.endsWith("/")) continue;
    const ext = n.split(".").pop()!.toLowerCase();
    if (!overrides.has(n) && !defaults.has(ext)) bad(`${n}: has no content type (no Override, and no Default for .${ext})`);
  }
  for (const n of names) {
    if (n.endsWith(".xml") || n.endsWith(".rels") || n.endsWith(".vml")) xml(n);
  }

  // ---- relationships ----
  const relsOf = (part: string) => part.replace(/([^/]+)$/, "_rels/$1.rels");
  const relationships = (part: string): XmlElement[] => childrenNamed(xml(relsOf(part)), "Relationship");
  for (const n of names.filter((x) => x.endsWith(".rels"))) {
    const owner = n.replace(/_rels\/([^/]+)\.rels$/, "$1");
    if (owner !== "" && n !== "_rels/.rels" && !files[owner]) bad(`${n}: belongs to ${owner}, which isn't in the package`);
    const ids = new Set<string>();
    for (const r of childrenNamed(xml(n), "Relationship")) {
      const id = r.attrs["Id"] ?? "";
      if (ids.has(id)) bad(`${n}: relationship id ${id} is used twice`);
      ids.add(id);
      if (r.attrs["TargetMode"] === "External") continue;
      const target = r.attrs["Target"] ?? "";
      const base = n === "_rels/.rels" ? "x" : owner;
      const path = resolve(base, target);
      if (!files[path]) bad(`${n}: ${id} points at ${path}, which isn't in the package`);
    }
  }
  /** Every r:id in a part must be one of the part's relationships. */
  const checkRefs = (part: string, node: XmlElement | undefined) => {
    if (!node) return;
    const ids = new Set(relationships(part).map((r) => r.attrs["Id"]));
    const walk = (el: XmlElement) => {
      for (const [k, v] of Object.entries(el.attrs)) if (/^r:(id|embed|link|pict)$/.test(k) && !ids.has(v)) bad(`${part}: <${el.name}> refers to ${v}, which isn't a relationship of the part`);
      for (const c of elements(el)) walk(c);
    };
    walk(node);
  };
  for (const n of names) if (/\.(xml|vml)$/.test(n) && !n.includes("_rels/") && n !== "[Content_Types].xml" && relationships(n).length + 1 > 0) checkRefs(n, xml(n));

  // ---- the order of a part's children ----
  const order = (part: string, root: XmlElement | undefined, list: string[]) => {
    if (!root) return;
    let last = -1;
    for (const c of elements(root)) {
      const at = list.indexOf(c.name);
      if (at < 0) bad(`${part}: <${c.name}> isn't a child element the schema knows for <${root.name}>`);
      else if (at < last) bad(`${part}: <${c.name}> comes after <${list[last]}>, which the schema puts after it`);
      else last = at;
    }
  };

  // ---- the workbook ----
  // ---- pictures placed in cells: a chain of numbers that must lead somewhere ----
  const meta = xml("xl/metadata.xml");
  if (meta || files["xl/richData/rdrichvalue.xml"]) {
    const valueBks = childrenNamed(child(meta, "valueMetadata"), "bk");
    const futureBks = childrenNamed(childrenNamed(meta, "futureMetadata").find((f) => f.attrs["name"] === "XLRICHVALUE"), "bk");
    const rvs = childrenNamed(xml("xl/richData/rdrichvalue.xml"), "rv");
    const shapes = childrenNamed(xml("xl/richData/rdrichvaluestructure.xml"), "s");
    const relCount = childrenNamed(xml("xl/richData/richValueRel.xml"), "rel").length;
    const declared = (el: XmlElement | undefined, what: string, n: number) => el && el.attrs["count"] !== undefined && Number(el.attrs["count"]) !== n && bad(`xl/metadata.xml or richData: ${what} says count="${el.attrs["count"]}" but has ${n}`);
    declared(child(meta, "valueMetadata"), "valueMetadata", valueBks.length);
    declared(xml("xl/richData/rdrichvalue.xml"), "rdrichvalue", rvs.length);
    declared(xml("xl/richData/rdrichvaluestructure.xml"), "rdrichvaluestructure", shapes.length);
    valueBks.forEach((bk, i) => {
      const v = Number(child(bk, "rc")?.attrs["v"]);
      if (!(v >= 0 && v < futureBks.length)) bad(`xl/metadata.xml: value ${i + 1} points at future metadata ${v}, and there are ${futureBks.length}`);
    });
    futureBks.forEach((bk, i) => {
      const find = (n: XmlElement): XmlElement | undefined => (n.name === "rvb" ? n : elements(n).map(find).find(Boolean));
      const at = Number(find(bk)?.attrs["i"]);
      if (!(at >= 0 && at < rvs.length)) bad(`xl/metadata.xml: future metadata ${i} points at rich value ${at}, and there are ${rvs.length}`);
    });
    rvs.forEach((rv, i) => {
      const shape = shapes[Number(rv.attrs["s"])];
      if (!shape) return bad(`xl/richData/rdrichvalue.xml: rich value ${i} has structure ${rv.attrs["s"]}, which isn't there`);
      const keys = childrenNamed(shape, "k");
      const vals = childrenNamed(rv, "v");
      if (keys.length !== vals.length) bad(`xl/richData/rdrichvalue.xml: rich value ${i} has ${vals.length} values and its structure has ${keys.length} keys`);
      const at = keys.findIndex((k) => k.attrs["n"] === "_rvRel:LocalImageIdentifier");
      if (at >= 0 && !(Number(textOf(vals[at])) >= 0 && Number(textOf(vals[at])) < relCount)) bad(`xl/richData/rdrichvalue.xml: rich value ${i} names picture ${textOf(vals[at])}, and richValueRel.xml has ${relCount}`);
    });
    for (const path of names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
      for (const c of elements(child(xml(path), "sheetData") ?? ({ name: "", attrs: {}, children: [] } as unknown as XmlElement)).flatMap((r) => childrenNamed(r, "c"))) {
        const vm = c.attrs["vm"];
        if (vm !== undefined && !(Number(vm) >= 1 && Number(vm) <= valueBks.length)) bad(`${path}: cell ${c.attrs["r"]} has vm="${vm}", and there are ${valueBks.length} values in xl/metadata.xml`);
      }
    }
  }

  const book = xml("xl/workbook.xml");
  order("xl/workbook.xml", book, WORKBOOK_ORDER);
  const sheetEls = childrenNamed(child(book, "sheets"), "sheet");
  const sheetNames = sheetEls.map((s) => s.attrs["name"] ?? "");
  const lower = sheetNames.map((n) => n.toLowerCase());
  sheetNames.forEach((n, i) => {
    if (n === "" || n.length > 31 || /[:\\/?*[\]]/.test(n) || /^'|'$/.test(n)) bad(`xl/workbook.xml: sheet name "${n}" isn't allowed`);
    if (lower.indexOf(n.toLowerCase()) !== i) bad(`xl/workbook.xml: sheet name "${n}" is used twice`);
  });
  const sheetIds = sheetEls.map((s) => s.attrs["sheetId"]);
  if (new Set(sheetIds).size !== sheetIds.length) bad("xl/workbook.xml: sheetId values repeat");
  const calcPr = child(book, "calcPr");
  if (calcPr?.attrs["iterate"] === "1") {
    const count = calcPr.attrs["iterateCount"];
    const delta = calcPr.attrs["iterateDelta"];
    if (count !== undefined && !(Number.isInteger(Number(count)) && Number(count) >= 1 && Number(count) <= 32767)) bad(`xl/workbook.xml: calcPr iterateCount "${count}" isn't a whole number from 1 to 32767`);
    if (delta !== undefined && !(Number.isFinite(Number(delta)) && Number(delta) >= 0)) bad(`xl/workbook.xml: calcPr iterateDelta "${delta}" isn't a number that is not negative`);
  } else if (calcPr && (calcPr.attrs["iterateCount"] !== undefined || calcPr.attrs["iterateDelta"] !== undefined)) bad("xl/workbook.xml: calcPr has iterate settings but iterate is not turned on");
  for (const d of childrenNamed(child(book, "definedNames"), "definedName")) {
    const name = d.attrs["name"] ?? "";
    if (!/^[A-Za-z_\\][A-Za-z0-9_.\\]*$/.test(name) || parseRef(name.toUpperCase())) bad(`xl/workbook.xml: defined name "${name}" isn't a valid name`);
    if (textOf(d).trim() === "") bad(`xl/workbook.xml: defined name "${name}" has no formula`);
  }

  // ---- styles ----
  const styles = xml("xl/styles.xml");
  order("xl/styles.xml", styles, STYLES_ORDER);
  const countOf = (name: string, item: string) => {
    const holder = child(styles, name);
    const n = childrenNamed(holder, item).length;
    if (holder && holder.attrs["count"] !== undefined && Number(holder.attrs["count"]) !== n) bad(`xl/styles.xml: <${name} count="${holder.attrs["count"]}"> has ${n} items`);
    return n;
  };
  const fonts = countOf("fonts", "font");
  // Excel is strict about the order inside a font (and writes `family` right after `name`).
  for (const f of [...childrenNamed(child(styles, "fonts"), "font"), ...childrenNamed(child(styles, "dxfs"), "dxf").flatMap((d) => childrenNamed(d, "font"))]) {
    order("xl/styles.xml", f, FONT_ORDER);
    for (const name of ["name", "family"]) if (childrenNamed(f, name).length > 1) bad(`xl/styles.xml: a font has <${name}> twice`);
    const fam = child(f, "family");
    if (fam && !/^[0-5]$/.test(fam.attrs["val"] ?? "")) bad(`xl/styles.xml: a font has family val="${fam.attrs["val"]}", which isn't 0 to 5`);
  }
  const fills = countOf("fills", "fill");
  const borders = countOf("borders", "border");
  const xfs = countOf("cellXfs", "xf");
  const dxfs = countOf("dxfs", "dxf");
  const customFormats = new Set(childrenNamed(child(styles, "numFmts"), "numFmt").map((f) => Number(f.attrs["numFmtId"])));
  for (const [i, xf] of childrenNamed(child(styles, "cellXfs"), "xf").entries()) {
    if (Number(xf.attrs["fontId"] ?? 0) >= fonts) bad(`xl/styles.xml: cellXfs[${i}] uses font ${xf.attrs["fontId"]}, of ${fonts}`);
    if (Number(xf.attrs["fillId"] ?? 0) >= fills) bad(`xl/styles.xml: cellXfs[${i}] uses fill ${xf.attrs["fillId"]}, of ${fills}`);
    if (Number(xf.attrs["borderId"] ?? 0) >= borders) bad(`xl/styles.xml: cellXfs[${i}] uses border ${xf.attrs["borderId"]}, of ${borders}`);
    const fmt = Number(xf.attrs["numFmtId"] ?? 0);
    if (fmt >= 164 && !customFormats.has(fmt)) bad(`xl/styles.xml: cellXfs[${i}] uses number format ${fmt}, which isn't defined`);
  }
  // The fills Excel requires first.
  const firstFills = childrenNamed(child(styles, "fills"), "fill").slice(0, 2).map((f) => attr(child(f, "patternFill"), "patternType"));
  if (firstFills[0] !== "none" || firstFills[1] !== "gray125") bad('xl/styles.xml: the first two fills must be patternType "none" and "gray125"');

  // ---- sharedStrings ----
  const sst = xml("xl/sharedStrings.xml");
  const stringCount = childrenNamed(sst, "si").length;
  if (sst && sst.attrs["uniqueCount"] !== undefined && Number(sst.attrs["uniqueCount"]) !== stringCount) bad(`xl/sharedStrings.xml: uniqueCount ${sst.attrs["uniqueCount"]} but ${stringCount} strings`);

  // ---- each sheet ----
  const tableNames = new Set<string>();
  const tableIds = new Set<string>();
  const relsTarget = (part: string, id: string | undefined) => {
    const t = relationships(part).find((r) => r.attrs["Id"] === id);
    return t && t.attrs["TargetMode"] !== "External" ? resolve(part, t.attrs["Target"] ?? "") : undefined;
  };
  const workbookRels = relationships("xl/workbook.xml");
  const sheetParts: { path: string; name: string; root: XmlElement }[] = [];
  sheetEls.forEach((el) => {
    const rel = workbookRels.find((r) => r.attrs["Id"] === attr(el, "id", "r"));
    const path = rel ? resolve("xl/workbook.xml", rel.attrs["Target"] ?? "") : "";
    const root = path ? xml(path) : undefined;
    if (!root) return bad(`xl/workbook.xml: sheet "${el.attrs["name"]}" has no part`);
    order(path, root, WORKSHEET_ORDER);
    sheetParts.push({ path, name: el.attrs["name"] ?? "", root });

    // cells and rows
    const rows = childrenNamed(child(root, "sheetData"), "row");
    let lastRow = 0;
    let used = { r: 0, c: 0 };
    const cells = new Map<string, XmlElement>();
    for (const row of rows) {
      const r = Number(row.attrs["r"]);
      if (!(r > lastRow)) bad(`${path}: row ${r} comes after row ${lastRow}`);
      lastRow = r;
      let lastCol = 0;
      for (const c of childrenNamed(row, "c")) {
        const ref = c.attrs["r"] ?? "";
        const p = parseRef(ref);
        if (!p || p.row !== r) bad(`${path}: cell ${ref} is in row ${r}`);
        else {
          if (p.col <= lastCol) bad(`${path}: cell ${ref} comes after a cell to its right`);
          lastCol = p.col;
          used = { r: Math.max(used.r, p.row), c: Math.max(used.c, p.col) };
        }
        if (cells.has(ref)) bad(`${path}: cell ${ref} appears twice`);
        cells.set(ref, c);
        if (Number(c.attrs["s"] ?? 0) >= xfs) bad(`${path}: cell ${ref} uses style ${c.attrs["s"]}, of ${xfs}`);
        const v = textOf(child(c, "v"));
        if (c.attrs["t"] === "s" && !(Number(v) < stringCount)) bad(`${path}: cell ${ref} uses shared string ${v}, of ${stringCount}`);
        const f = textOf(child(c, "f"));
        if (f.length > 8192) bad(`${path}: cell ${ref} has a formula of ${f.length} characters (8192 at most)`);
        if (c.attrs["t"] === "inlineStr" ? textOf(child(c, "is")).length > 32767 : c.attrs["t"] !== "s" && v.length > 32767) bad(`${path}: cell ${ref} has more than 32767 characters`);
      }
    }
    const cellText = (ref: string): string | undefined => {
      const c = cells.get(ref);
      if (!c) return undefined;
      if (c.attrs["t"] === "s") return textOf(childrenNamed(sst, "si")[Number(textOf(child(c, "v")))]);
      if (c.attrs["t"] === "inlineStr") return textOf(child(c, "is"));
      return textOf(child(c, "v"));
    };

    // counts
    for (const [holder, item] of [["mergeCells", "mergeCell"], ["dataValidations", "dataValidation"], ["hyperlinks", "hyperlink"]] as const) {
      const h = child(root, holder);
      if (h && h.attrs["count"] !== undefined && Number(h.attrs["count"]) !== childrenNamed(h, item).length) bad(`${path}: <${holder} count="${h.attrs["count"]}"> has ${childrenNamed(h, item).length} items`);
    }
    // merges don't overlap
    const merged = childrenNamed(child(root, "mergeCells"), "mergeCell").map((m) => parseRange(m.attrs["ref"] ?? ""));
    merged.forEach((a, i) => {
      if (!a) return bad(`${path}: a merged range isn't a range`);
      merged.slice(0, i).forEach((b) => b && !(a.r2 < b.r1 || a.r1 > b.r2 || a.c2 < b.c1 || a.c1 > b.c2) && bad(`${path}: merged ranges overlap`));
    });
    // conditional formatting: priorities are unique and dxfs exist
    const priorities = new Set<string>();
    for (const cf of childrenNamed(root, "conditionalFormatting")) {
      for (const rule of childrenNamed(cf, "cfRule")) {
        const p = rule.attrs["priority"] ?? "";
        if (priorities.has(p)) bad(`${path}: two conditional formatting rules have priority ${p}`);
        priorities.add(p);
        if (rule.attrs["dxfId"] !== undefined && Number(rule.attrs["dxfId"]) >= dxfs) bad(`${path}: a rule uses differential format ${rule.attrs["dxfId"]}, of ${dxfs}`);
      }
    }
    // data validation lists in quotes are at most 255 characters
    for (const v of childrenNamed(child(root, "dataValidations"), "dataValidation")) {
      const f1 = textOf(child(v, "formula1"));
      if (v.attrs["type"] === "list" && /^"/.test(f1) && f1.length > 257) bad(`${path}: a list of choices in a validation is ${f1.length - 2} characters (255 at most)`);
    }
    // hyperlinks lead somewhere
    for (const h of childrenNamed(child(root, "hyperlinks"), "hyperlink")) {
      const id = attr(h, "id", "r");
      if (!id && !h.attrs["location"]) bad(`${path}: hyperlink ${h.attrs["ref"]} has neither an address nor a location`);
      if (id && !relationships(path).some((r) => r.attrs["Id"] === id && r.attrs["TargetMode"] === "External")) bad(`${path}: hyperlink ${h.attrs["ref"]} refers to ${id}, which isn't an external relationship`);
    }

    // drawing: ids unique, pictures and charts exist
    const drawingPart = relsTarget(path, attr(child(root, "drawing"), "id", "r"));
    if (child(root, "drawing") && !drawingPart) bad(`${path}: <drawing> has no part`);
    if (drawingPart) {
      const drawing = xml(drawingPart);
      const seen = new Set<string>();
      const walk = (n: XmlElement) => {
        // The fallback shape of an alternate-content wrapper (a slicer's placeholder) is written with id 0 by Excel itself.
        if (n.name === "Fallback") return;
        if (n.name === "cNvPr") {
          const id = n.attrs["id"] ?? "";
          if (seen.has(id)) bad(`${drawingPart}: shape id ${id} is used twice`);
          seen.add(id);
        }
        if (n.name === "twoCellAnchor") {
          const edit = n.attrs["editAs"];
          if (edit !== undefined && !["twoCell", "oneCell", "absolute"].includes(edit)) bad(`${drawingPart}: a two-cell anchor says editAs="${edit}", which isn't twoCell, oneCell or absolute`);
          const pos = (el: XmlElement | undefined) => ["col", "row"].map((k) => Number(textOf(child(el, k)))) as [number, number];
          const [fc, fr] = pos(child(n, "from"));
          const [tc, tr] = pos(child(n, "to"));
          if (!child(n, "from") || !child(n, "to")) bad(`${drawingPart}: a two-cell anchor needs a from and a to`);
          else if (tc < fc || tr < fr) bad(`${drawingPart}: a two-cell anchor ends (column ${tc}, row ${tr}) before it starts (column ${fc}, row ${fr})`);
        }
        if (n.name === "srcRect") {
          const part = (k: string) => Number(n.attrs[k] ?? 0);
          if (["l", "t", "r", "b"].some((k) => !Number.isInteger(part(k)))) bad(`${drawingPart}: a crop (srcRect) has an edge that isn't a whole number`);
          else if (part("l") + part("r") >= 100000 || part("t") + part("b") >= 100000) bad(`${drawingPart}: a crop (srcRect) cuts off the whole picture`);
        }
        if (n.name === "xfrm" && n.attrs["rot"] !== undefined) {
          const rot = Number(n.attrs["rot"]);
          if (!Number.isInteger(rot) || rot < 0 || rot >= 21600000) bad(`${drawingPart}: a rotation of ${n.attrs["rot"]} isn't from 0 up to 21,600,000 (a full turn in sixty-thousandths of a degree)`);
        }
        if (n.name === "imgLayer") {
          // the original of a picture with an artistic effect: Excel only takes an HD Photo file, by the relationship made for it
          const t = relationships(drawingPart).find((r) => r.attrs["Id"] === n.attrs["r:embed"]);
          if (!t || !/\/relationships\/hdphoto$/.test(t.attrs["Type"] ?? "") || !/\.wdp$/i.test(t.attrs["Target"] ?? "")) bad(`${drawingPart}: an effect's layer (${n.attrs["r:embed"]}) isn't an HD Photo: the relationship should be the hdphoto one and the file a .wdp`);
        }
        if (n.name === "blipFill" && elements(n).length > 1) {
          const order = elements(n).map((e) => e.name);
          if (order.indexOf("srcRect") > order.indexOf("stretch") && order.includes("stretch")) bad(`${drawingPart}: a picture's crop (srcRect) comes after its stretch`);
        }
        for (const c of elements(n)) walk(c);
      };
      if (drawing) walk(drawing);
      const dr = relationships(drawingPart);
      const usedIds = new Set<string>();
      const gather = (n: XmlElement) => {
        for (const [k, v] of Object.entries(n.attrs)) if (/^r:(id|embed)$/.test(k)) usedIds.add(v);
        for (const c of elements(n)) gather(c);
      };
      if (drawing) gather(drawing);
      for (const r of dr) if (!usedIds.has(r.attrs["Id"] ?? "")) bad(`${drawingPart}: relationship ${r.attrs["Id"]} is never used`);
    }

    // comments: a box for each note, in the legacy drawing
    const commentsRel = relationships(path).find((r) => /\/comments$/.test(r.attrs["Type"] ?? ""));
    if (commentsRel) {
      const commentsPart = resolve(path, commentsRel.attrs["Target"] ?? "");
      const comments = childrenNamed(child(xml(commentsPart), "commentList"), "comment");
      const authors = childrenNamed(child(xml(commentsPart), "authors"), "author").length;
      const legacy = relsTarget(path, attr(child(root, "legacyDrawing"), "id", "r"));
      if (!legacy) bad(`${path}: has comments but no legacy drawing for their boxes`);
      else {
        const shapes = childrenNamed(xml(legacy), "shape").filter((s) => attr(child(s, "ClientData"), "ObjectType") === "Note");
        if (shapes.length !== comments.length) bad(`${legacy}: ${shapes.length} note boxes for ${comments.length} comments`);
        const at = new Set(shapes.map((s) => `${textOf(child(child(s, "ClientData"), "Row"))}:${textOf(child(child(s, "ClientData"), "Column"))}`));
        for (const c of comments) {
          const p = parseRef(c.attrs["ref"] ?? "");
          if (!p) bad(`${commentsPart}: comment on "${c.attrs["ref"]}" isn't a cell`);
          else if (!at.has(`${p.row - 1}:${p.col - 1}`)) bad(`${legacy}: no box for the comment on ${c.attrs["ref"]}`);
          if (Number(c.attrs["authorId"] ?? 0) >= authors) bad(`${commentsPart}: comment on ${c.attrs["ref"]} has an author that isn't listed`);
        }
        // a picture that fills a box is a relationship of the drawing
        const drawingIds = new Set(relationships(legacy).map((r) => r.attrs["Id"]));
        for (const shape of shapes) {
          const relid = attr(child(shape, "fill"), "relid", "o");
          if (relid && !drawingIds.has(relid)) bad(`${legacy}: a note box's picture refers to ${relid}, which isn't a relationship of the drawing`);
        }
        const shapeIds = shapes.map((s) => s.attrs["id"]);
        if (new Set(shapeIds).size !== shapeIds.length) bad(`${legacy}: shape ids repeat`);
      }
    }

    // pictures in the header and footer: a legacy drawing of shapes named for their place, each pointing at a picture file
    const hfPart = relsTarget(path, attr(child(root, "legacyDrawingHF"), "id", "r"));
    if (child(root, "legacyDrawingHF") && !hfPart) bad(`${path}: legacyDrawingHF points at a part that isn't there`);
    if (hfPart) {
      const vml = xml(hfPart);
      const rels = relationships(hfPart);
      const shapeTypes = new Set(childrenNamed(vml, "shapetype").map((t) => `#${t.attrs["id"]}`));
      const placeIds = new Set(["LH", "CH", "RH", "LF", "CF", "RF"].flatMap((p) => [p, `${p}EVEN`, `${p}FIRST`]));
      const idmap = (attr(child(child(vml, "shapelayout"), "idmap"), "data") ?? "").split(",").map((n) => Number(n.trim())).filter((n) => Number.isInteger(n));
      const hfText = [...elements(child(root, "headerFooter") ?? ({ name: "", attrs: {}, children: [] } as unknown as XmlElement))].map((e) => [e.name, textOf(e)] as const);
      const ids = new Set<string>();
      const spids = new Set<string>();
      // The shape numbers of the notes' drawing, which the header's must not share.
      const noteNumbers = new Set<string>();
      const commentsRel2 = relationships(path).find((r) => /\/comments$/.test(r.attrs["Type"] ?? ""));
      const notesVml = commentsRel2 ? relsTarget(path, attr(child(root, "legacyDrawing"), "id", "r")) : undefined;
      if (notesVml) for (const sh of childrenNamed(xml(notesVml), "shape")) if (sh.attrs["id"]) noteNumbers.add(sh.attrs["id"]);
      if (!idmap.length) bad(`${hfPart}: has no shapelayout idmap, which says which block of shape numbers the drawing uses`);
      for (const shape of childrenNamed(vml, "shape")) {
        const id = shape.attrs["id"] ?? "";
        if (!placeIds.has(id)) bad(`${hfPart}: shape "${id}" isn't one of the header and footer places (LH CH RH LF CF RF, with EVEN or FIRST added)`);
        if (ids.has(id)) bad(`${hfPart}: shape id ${id} is used twice`);
        ids.add(id);
        if (!shapeTypes.has(shape.attrs["type"] ?? "")) bad(`${hfPart}: shape ${id} has type="${shape.attrs["type"]}", which no shapetype of the drawing defines`);
        const spid = attr(shape, "spid", "o") ?? "";
        const num = /^_x0000_s(\d+)$/.exec(spid);
        if (!num) bad(`${hfPart}: shape ${id} has o:spid="${spid}", which isn't _x0000_s and a number`);
        else {
          if (spids.has(spid)) bad(`${hfPart}: o:spid ${spid} is used twice`);
          spids.add(spid);
          if (noteNumbers.has(spid)) bad(`${hfPart}: o:spid ${spid} is also a shape number of the notes' drawing`);
          if (idmap.length && !idmap.includes(Math.floor(Number(num[1]) / 1024))) bad(`${hfPart}: o:spid ${spid} lies outside the blocks the idmap names (${idmap.join(", ")})`);
        }
        const data = child(shape, "imagedata");
        const rid = attr(data, "relid", "o");
        const rel = rels.find((r) => r.attrs["Id"] === rid);
        if (!data || !rid) bad(`${hfPart}: shape ${id} has no picture (v:imagedata o:relid)`);
        else if (!rel || !/\/image$/.test(rel.attrs["Type"] ?? "")) bad(`${hfPart}: shape ${id} points at ${rid}, which isn't an image relationship of the drawing`);
        // The picture only shows where the header text has the &G code.
        const side = id.slice(0, 1);
        const kind = id.slice(1, 2) === "H" ? "Header" : "Footer";
        const tag = `${id.endsWith("EVEN") ? "even" : id.endsWith("FIRST") ? "first" : "odd"}${kind}`;
        const text = hfText.find(([name]) => name === tag)?.[1] ?? "";
        const at = text.indexOf(`&${side}`);
        const part = at < 0 ? "" : text.slice(at + 2).split(/&[LCR]/)[0]!;
        if (!/&G/i.test(part)) bad(`${path}: ${id} has a picture, and the ${tag} text has no &G in its ${side === "L" ? "left" : side === "C" ? "centre" : "right"} part`);
      }
    }

    // tables
    for (const part of childrenNamed(child(root, "tableParts"), "tablePart")) {
      const tablePath = relsTarget(path, attr(part, "id", "r"));
      const table = tablePath ? xml(tablePath) : undefined;
      if (!table || !tablePath) {
        bad(`${path}: a table part is missing`);
        continue;
      }
      order(tablePath, table, TABLE_ORDER);
      const name = table.attrs["name"] ?? "";
      const display = table.attrs["displayName"] ?? "";
      if (tableNames.has(display.toLowerCase())) bad(`${tablePath}: table name "${display}" is used twice`);
      tableNames.add(display.toLowerCase());
      if (name !== display) bad(`${tablePath}: name "${name}" and displayName "${display}" differ`);
      if (!/^[A-Za-z_\\][A-Za-z0-9_.]*$/.test(display) || parseRef(display.toUpperCase())) bad(`${tablePath}: "${display}" isn't a valid table name`);
      if (tableIds.has(table.attrs["id"] ?? "")) bad(`${tablePath}: table id ${table.attrs["id"]} is used twice`);
      tableIds.add(table.attrs["id"] ?? "");
      const range = parseRange(table.attrs["ref"] ?? "");
      if (!range) {
        bad(`${tablePath}: ref "${table.attrs["ref"]}" isn't a range`);
        continue;
      }
      const columns = childrenNamed(child(table, "tableColumns"), "tableColumn");
      if (Number(child(table, "tableColumns")?.attrs["count"]) !== columns.length) bad(`${tablePath}: tableColumns count doesn't match`);
      if (columns.length !== range.c2 - range.c1 + 1) bad(`${tablePath}: ${columns.length} columns for a range ${range.c2 - range.c1 + 1} wide`);
      const colNames = columns.map((c) => c.attrs["name"] ?? "");
      if (new Set(colNames.map((n) => n.toLowerCase())).size !== colNames.length) bad(`${tablePath}: column names repeat`);
      const ids = columns.map((c) => c.attrs["id"]);
      if (new Set(ids).size !== ids.length) bad(`${tablePath}: column ids repeat`);
      const headerRows = table.attrs["headerRowCount"] === "0" ? 0 : 1;
      if (headerRows) {
        // Excel repairs a table whose header cells don't say what its columns are called.
        const letters = (n: number) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
        colNames.forEach((n, i) => {
          const text = cellText(`${letters(range.c1 + i)}${range.r1}`);
          if (text !== n) bad(`${tablePath}: column "${n}" but its header cell ${letters(range.c1 + i)}${range.r1} says "${text ?? ""}"`);
        });
      }
      const filter = parseRange(child(table, "autoFilter")?.attrs["ref"] ?? "A1");
      if (child(table, "autoFilter") && filter && (filter.r1 < range.r1 || filter.r2 > range.r2 || filter.c1 < range.c1 || filter.c2 > range.c2)) bad(`${tablePath}: the filter reaches outside the table`);
      if (range.r2 > used.r || range.c2 > used.c) { /* a table may extend over empty cells */ }
    }
  });

  // ---- merged cells and conditional formats, in the worksheets and in pivot tables ----
  lintFormatting({ files, names, xml, bad, sheets: sheetParts, relationships, dxfCount: dxfs });

  // ---- filters that point at styles ----
  const dxfCount = childrenNamed(child(xml("xl/styles.xml"), "dxfs"), "dxf").length;
  const collect = (el: XmlElement | undefined, name: string, out: XmlElement[] = []): XmlElement[] => {
    for (const c of elements(el)) {
      if (c.name === name) out.push(c);
      collect(c, name, out);
    }
    return out;
  };
  for (const n of names.filter((x) => /^xl\/(worksheets\/sheet|tables\/table)\d+\.xml$/.test(x))) {
    for (const c of collect(xml(n), "colorFilter")) {
      const id = Number(c.attrs["dxfId"]);
      if (!Number.isInteger(id) || id < 0 || id >= dxfCount) bad(`${n}: a colour filter uses style ${c.attrs["dxfId"]}, and the stylesheet has ${dxfCount}`);
    }
    for (const c of collect(xml(n), "top10")) if (!(Number(c.attrs["val"]) >= 1)) bad(`${n}: a top or bottom filter has no count`);
    for (const c of collect(xml(n), "customFilters")) {
      const count = childrenNamed(c, "customFilter").length;
      if (count < 1 || count > 2) bad(`${n}: customFilters holds ${count} comparisons, and Excel takes one or two`);
    }
  }

  // ---- pivot tables ----
  const PIVOT_ORDER = ["location", "pivotFields", "rowFields", "rowItems", "colFields", "colItems", "pageFields", "dataFields", "formats", "conditionalFormats", "chartFormats", "pivotHierarchies", "pivotTableStyleInfo", "filters", "rowHierarchiesUsage", "colHierarchiesUsage", "extLst"];
  const bookRels = childrenNamed(xml("xl/_rels/workbook.xml.rels"), "Relationship");
  const cacheIds = new Map<string, string>();
  for (const c of childrenNamed(child(book, "pivotCaches"), "pivotCache")) {
    const id = c.attrs["cacheId"] ?? "";
    const rid = attr(c, "id", "r");
    if (cacheIds.has(id)) bad(`xl/workbook.xml: pivot cache id ${id} is used twice`);
    if (!bookRels.some((r) => r.attrs["Id"] === rid)) bad(`xl/workbook.xml: pivot cache ${id} points at ${rid}, which the workbook's relationships don't have`);
    cacheIds.set(id, rid ?? "");
  }
  for (const n of names.filter((x) => /^xl\/pivotTables\/pivotTable\d+\.xml$/.test(x))) {
    const t = xml(n);
    if (!t) continue;
    order(n, t, PIVOT_ORDER);
    const cacheId = t.attrs["cacheId"] ?? "";
    if (!cacheIds.has(cacheId)) bad(`${n}: cacheId ${cacheId} isn't one of the workbook's pivotCaches`);
    const countOf = (parent: XmlElement | undefined, kids: string, what: string) => {
      if (!parent) return 0;
      const have = childrenNamed(parent, kids).length;
      if (parent.attrs["count"] !== undefined && Number(parent.attrs["count"]) !== have) bad(`${n}: <${parent.name}> says count="${parent.attrs["count"]}" but has ${have} ${what}`);
      return have;
    };
    const rels = xml(`xl/pivotTables/_rels/${n.split("/").pop()}.rels`);
    const cacheTarget = childrenNamed(rels, "Relationship").find((r) => /pivotCacheDefinition$/.test(r.attrs["Type"] ?? ""))?.attrs["Target"];
    const cachePath = cacheTarget ? resolve(n, cacheTarget) : undefined;
    const cache = cachePath ? xml(cachePath) : undefined;
    if (!cache) bad(`${n}: its cache definition isn't there`);
    const cacheFields = childrenNamed(child(cache, "cacheFields"), "cacheField");
    const fields = childrenNamed(child(t, "pivotFields"), "pivotField");
    countOf(child(t, "pivotFields"), "pivotField", "pivotField elements");
    if (cache && fields.length !== cacheFields.length) bad(`${n}: ${fields.length} pivot fields but the cache has ${cacheFields.length} fields`);
    fields.forEach((f, i) => {
      const items = child(f, "items");
      if (!items) return;
      const have = countOf(items, "item", "items");
      // A grouped field's items are the groups its fieldGroup lists, not the field's own shared items.
      const grouped = child(child(cacheFields[i], "fieldGroup"), "groupItems");
      const shared = grouped ? elements(grouped).length : elements(child(cacheFields[i], "sharedItems")).length;
      for (const it of childrenNamed(items, "item")) {
        if (it.attrs["t"] === undefined && (it.attrs["x"] === undefined || Number(it.attrs["x"]) >= shared)) bad(`${n}: field ${i} has an item that points at shared item ${it.attrs["x"]}, and the cache lists ${shared}`);
      }
      // A field off the axes lists items only to leave some out (what a slicer does).
      // Excel lists the items of a field something is grouped over (its cache field says `<fieldGroup par="…"/>`) too.
      const groupedOver = child(cacheFields[i], "fieldGroup")?.attrs["par"] !== undefined && child(cacheFields[i], "fieldGroup")?.attrs["base"] === undefined;
      // …and a date field a timeline filters (the cache field holds dates).
      const dated = child(cacheFields[i], "sharedItems")?.attrs["containsDate"] === "1";
      if (f.attrs["axis"] === undefined && !groupedOver && !dated && !childrenNamed(items, "item").some((it) => it.attrs["h"] === "1")) bad(`${n}: field ${i} lists items but isn't on an axis`);
      void have;
    });
    const ref = parseRange(attr(child(t, "location"), "ref") ?? "");
    if (!ref) bad(`${n}: <location> has no valid ref`);
    const field = (x: string | undefined) => {
      const v = Number(x);
      if (!(v === -2 || (Number.isInteger(v) && v >= 0 && v < fields.length))) bad(`${n}: a field index ${x} isn't one of the ${fields.length} fields`);
    };
    countOf(child(t, "rowFields"), "field", "fields");
    countOf(child(t, "colFields"), "field", "fields");
    for (const f of [...childrenNamed(child(t, "rowFields"), "field"), ...childrenNamed(child(t, "colFields"), "field")]) field(f.attrs["x"]);
    const rowItems = countOf(child(t, "rowItems"), "i", "rows");
    const colItems = countOf(child(t, "colItems"), "i", "columns");
    if (ref && child(t, "rowItems") && rowItems + Number(attr(child(t, "location"), "firstDataRow") ?? 0) !== ref.r2 - ref.r1 + 1) bad(`${n}: rowItems lists ${rowItems} rows, the first data row is ${attr(child(t, "location"), "firstDataRow")}, and the table is ${ref.r2 - ref.r1 + 1} rows high`);
    if (ref && child(t, "colItems") && child(t, "dataFields") && colItems + Number(attr(child(t, "location"), "firstDataCol") ?? 0) !== ref.c2 - ref.c1 + 1) bad(`${n}: colItems lists ${colItems} columns, the first data column is ${attr(child(t, "location"), "firstDataCol")}, and the table is ${ref.c2 - ref.c1 + 1} columns wide`);
    countOf(child(t, "pageFields"), "pageField", "page fields");
    for (const pf of childrenNamed(child(t, "pageFields"), "pageField")) field(pf.attrs["fld"]);
    countOf(child(t, "dataFields"), "dataField", "data fields");
    const names_ = new Set<string>();
    for (const d of childrenNamed(child(t, "dataFields"), "dataField")) {
      field(d.attrs["fld"]);
      const name = (d.attrs["name"] ?? "").toLowerCase();
      if (names_.has(name)) bad(`${n}: two data fields are called "${d.attrs["name"]}"`);
      names_.add(name);
      if (cacheFields.some((c) => (c.attrs["name"] ?? "").toLowerCase() === name)) bad(`${n}: data field "${d.attrs["name"]}" has the name of a source field, which Excel doesn't allow`);
    }
    // Sorting by a value and top and bottom filters name data fields; a difference names the field it compares along.
    const dataCount = childrenNamed(child(t, "dataFields"), "dataField").length;
    for (const f of fields) {
      for (const ref of childrenNamed(child(child(child(f, "autoSortScope"), "pivotArea"), "references"), "reference")) {
        if (ref.attrs["field"] === "4294967294" && !(Number(attr(child(ref, "x"), "v")) < dataCount)) bad(`${n}: a field is sorted by data field ${attr(child(ref, "x"), "v")}, and the table has ${dataCount}`);
      }
    }
    const flt = childrenNamed(child(t, "filters"), "filter");
    countOf(child(t, "filters"), "filter", "filters");
    const filterIds = new Set<string>();
    for (const fl of flt) {
      field(fl.attrs["fld"]);
      if (!(Number(fl.attrs["iMeasureFld"] ?? 0) < dataCount)) bad(`${n}: a filter is by data field ${fl.attrs["iMeasureFld"]}, and the table has ${dataCount}`);
      if (filterIds.has(fl.attrs["id"] ?? "")) bad(`${n}: two filters have id ${fl.attrs["id"]}`);
      filterIds.add(fl.attrs["id"] ?? "");
      const column = child(child(fl, "autoFilter"), "filterColumn");
      if (!child(column, "top10") && !child(column, "customFilters") && !child(column, "dynamicFilter")) bad(`${n}: a filter has no condition`);
      if (!/^(count|percent|sum|caption\w+|value\w+|date\w+|today|yesterday|tomorrow|(this|last|next)(Week|Month|Quarter|Year)|yearToDate|Q[1-4]|M([1-9]|1[0-2]))$/.test(fl.attrs["type"] ?? "")) bad(`${n}: a filter is of type "${fl.attrs["type"]}", which the file format doesn't have`);
      const custom = childrenNamed(child(column, "customFilters"), "customFilter");
      if (child(column, "customFilters") && (custom.length < 1 || custom.length > 2)) bad(`${n}: a filter has ${custom.length} conditions, and the format allows one or two`);
      if (/Between$/.test(fl.attrs["type"] ?? "") && custom.length !== 2) bad(`${n}: a between filter needs two conditions`);
    }
    if (t.attrs["dataOnRows"] === "1" && !childrenNamed(child(t, "rowFields"), "field").some((f) => f.attrs["x"] === "-2")) bad(`${n}: the values are on the rows (dataOnRows) but -2 isn't one of the row fields`);
    if (t.attrs["dataOnRows"] !== "1" && childrenNamed(child(t, "rowFields"), "field").some((f) => f.attrs["x"] === "-2")) bad(`${n}: -2 is a row field but dataOnRows isn't set`);
    for (const d of childrenNamed(child(t, "dataFields"), "dataField")) {
      for (const ext of childrenNamed(child(d, "extLst"), "ext")) {
        const as = attr(child(ext, "dataField"), "pivotShowAs");
        if (as !== undefined && !/^(percentOfParent|percentOfParentCol|percentOfParentRow|percentOfRunningTotal|rankAscending|rankDescending)$/.test(as)) bad(`${n}: data field "${d.attrs["name"]}" has pivotShowAs="${as}", which the extension doesn't have`);
      }
      if (d.attrs["showDataAs"] && !/^(normal|difference|percent|percentDiff|runTotal|percentOfRow|percentOfCol|percentOfTotal|index)$/.test(d.attrs["showDataAs"])) bad(`${n}: data field "${d.attrs["name"]}" is shown as "${d.attrs["showDataAs"]}", which the file format doesn't have`);
      if (d.attrs["baseField"] !== undefined) field(d.attrs["baseField"]);
    }
    if (!attr(t, "name")) bad(`${n}: the pivot table has no name`);
  }
  for (const n of names.filter((x) => /^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(x))) {
    const c = xml(n);
    if (!c) continue;
    const cacheFields = childrenNamed(child(c, "cacheFields"), "cacheField");
    if (child(c, "cacheFields")?.attrs["count"] !== undefined && Number(child(c, "cacheFields")!.attrs["count"]) !== cacheFields.length) bad(`${n}: <cacheFields> says count="${child(c, "cacheFields")!.attrs["count"]}" but has ${cacheFields.length}`);
    for (const f of cacheFields) {
      const si = child(f, "sharedItems");
      if (si?.attrs["count"] !== undefined && Number(si.attrs["count"]) !== elements(si).length) bad(`${n}: field "${f.attrs["name"]}" says ${si.attrs["count"]} shared items but lists ${elements(si).length}`);
    }
    if (!child(c, "cacheSource")) bad(`${n}: no <cacheSource>`);
    // Grouped fields: the field a group is over, its parent, and the items each of the field's own items goes under.
    cacheFields.forEach((f, i) => {
      const fg = child(f, "fieldGroup");
      if (!fg) return;
      // `<fieldGroup par="6"/>` alone: this field is the one a group is made over, and field 6 holds the group.
      if (fg.attrs["base"] === undefined && fg.attrs["par"] !== undefined && !child(fg, "rangePr") && !child(fg, "discretePr")) {
        if (!(Number(fg.attrs["par"]) >= 0 && Number(fg.attrs["par"]) < cacheFields.length && Number(fg.attrs["par"]) !== i)) bad(`${n}: field "${f.attrs["name"]}" has parent ${fg.attrs["par"]}, which isn't another field`);
        return;
      }
      const base = Number(fg.attrs["base"] ?? i);
      if (!(base >= 0 && base < cacheFields.length)) bad(`${n}: field "${f.attrs["name"]}" is a group over field ${fg.attrs["base"]}, which isn't there`);
      if (fg.attrs["par"] !== undefined && !(Number(fg.attrs["par"]) >= 0 && Number(fg.attrs["par"]) < cacheFields.length && Number(fg.attrs["par"]) !== i)) bad(`${n}: field "${f.attrs["name"]}" has parent ${fg.attrs["par"]}, which isn't another field`);
      const gi = child(fg, "groupItems");
      const listed = elements(gi).length;
      if (gi?.attrs["count"] !== undefined && Number(gi.attrs["count"]) !== listed) bad(`${n}: field "${f.attrs["name"]}" says ${gi.attrs["count"]} group items but lists ${listed}`);
      const discrete = child(fg, "discretePr");
      if (discrete) {
        const xs = childrenNamed(discrete, "x");
        const baseShared = elements(child(cacheFields[base], "sharedItems")).length;
        if (discrete.attrs["count"] !== undefined && Number(discrete.attrs["count"]) !== xs.length) bad(`${n}: field "${f.attrs["name"]}" says ${discrete.attrs["count"]} items are grouped but lists ${xs.length}`);
        if (xs.length !== baseShared) bad(`${n}: field "${f.attrs["name"]}" places ${xs.length} items under groups, and the field it groups has ${baseShared}`);
        for (const x of xs) if (!(Number(x.attrs["v"]) < listed)) bad(`${n}: field "${f.attrs["name"]}" sends an item to group ${x.attrs["v"]}, and there are ${listed}`);
      } else if (!child(fg, "rangePr")) bad(`${n}: field "${f.attrs["name"]}" has a fieldGroup with neither rangePr nor discretePr`);
    });
    // Items worked out from others: the item they name has to be one of the field's.
    for (const ci of childrenNamed(child(c, "calculatedItems"), "calculatedItem")) {
      const ref = child(child(child(ci, "pivotArea"), "references"), "reference");
      const field = Number(ref?.attrs["field"]);
      const shared = elements(child(cacheFields[field], "sharedItems")).length;
      if (!(Number(attr(child(ref, "x"), "v")) < shared)) bad(`${n}: a calculated item points at item ${attr(child(ref, "x"), "v")}, and field ${field} lists ${shared}`);
      if (!ci.attrs["formula"]) bad(`${n}: a calculated item has no formula`);
    }
    const src = child(child(c, "cacheSource"), "consolidation");
    if (src) {
      const sets = childrenNamed(child(src, "rangeSets"), "rangeSet");
      if (child(src, "rangeSets")?.attrs["count"] !== undefined && Number(child(src, "rangeSets")!.attrs["count"]) !== sets.length) bad(`${n}: <rangeSets> says count="${child(src, "rangeSets")!.attrs["count"]}" but has ${sets.length}`);
      const pages = childrenNamed(child(child(src, "pages"), "page"), "pageItem").length;
      for (const rs of sets) if (rs.attrs["i1"] !== undefined && !(Number(rs.attrs["i1"]) < pages)) bad(`${n}: a range set names page item ${rs.attrs["i1"]}, and there are ${pages}`);
    }
  }

  // ---- slicers and timelines on pivot tables ----
  const pivotNames = new Map<string, number>();
  for (const n of names.filter((x) => /^xl\/pivotTables\/pivotTable\d+\.xml$/.test(x))) pivotNames.set(xml(n)?.attrs["name"] ?? "", Number(xml(n)?.attrs["cacheId"]));
  const x14Ids = new Set<number>();
  for (const n of names.filter((x) => /^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(x))) {
    for (const ext of childrenNamed(child(xml(n), "extLst"), "ext")) {
      const id = child(ext, "pivotCacheDefinition")?.attrs["pivotCacheId"];
      if (id !== undefined) x14Ids.add(Number(id));
    }
  }
  for (const n of names.filter((x) => /^xl\/(slicerCaches\/slicerCache|timelineCaches\/timelineCache)\d+\.xml$/.test(x))) {
    const root = xml(n);
    const tables = childrenNamed(child(root, "pivotTables"), "pivotTable");
    for (const pt of tables) if (!pivotNames.has(pt.attrs["name"] ?? "")) bad(`${n}: filters the pivot table "${pt.attrs["name"]}", which isn't in the package`);
    const cacheId = child(child(root, "data"), "tabular")?.attrs["pivotCacheId"] ?? child(root, "state")?.attrs["pivotCacheId"];
    if (tables.length && cacheId !== undefined && !x14Ids.has(Number(cacheId))) bad(`${n}: points at pivot cache ${cacheId}, which no cache definition declares in its extension`);
    for (const item of childrenNamed(child(child(child(root, "data"), "tabular"), "items"), "i")) if (item.attrs["x"] === undefined) bad(`${n}: a slicer item has no x`);
    const state = child(root, "state");
    if (state && !child(state, "bounds")) bad(`${n}: a timeline has no bounds`);
  }
  for (const n of names.filter((x) => /^xl\/timelines\/timeline\d+\.xml$/.test(x))) {
    const tl = childrenNamed(xml(n), "timeline");
    if (!tl.length) bad(`${n}: no timelines`);
    for (const t of tl) if (!t.attrs["cache"] || !names.some((x) => /^xl\/timelineCaches\//.test(x)) || !(book && JSON.stringify(book).includes(`"name":"${t.attrs["cache"]}"`))) bad(`${n}: timeline "${t.attrs["name"]}" reads cache "${t.attrs["cache"]}", which the workbook doesn't define a name for`);
  }

  // ---- content types of the parts that have one fixed ----
  const expectType = (pattern: RegExp, type: string) => {
    for (const n of names.filter((x) => pattern.test(x))) if (overrides.get(n) !== type) bad(`${n}: content type is "${overrides.get(n) ?? defaults.get(n.split(".").pop()!) ?? "none"}", expected "${type}"`);
  };
  expectType(/^xl\/worksheets\/sheet\d+\.xml$/, "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
  expectType(/^xl\/tables\/table\d+\.xml$/, "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml");
  expectType(/^xl\/charts\/chart\d+\.xml$/, "application/vnd.openxmlformats-officedocument.drawingml.chart+xml");
  expectType(/^xl\/drawings\/drawing\d+\.xml$/, "application/vnd.openxmlformats-officedocument.drawing+xml");
  expectType(/^xl\/comments\d+\.xml$/, "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml");
  expectType(/^xl\/pivotTables\/pivotTable\d+\.xml$/, "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml");
  expectType(/^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/, "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml");
  expectType(/^xl\/slicers\/slicer\d+\.xml$/, "application/vnd.ms-excel.slicer+xml");
  expectType(/^xl\/slicerCaches\/slicerCache\d+\.xml$/, "application/vnd.ms-excel.slicerCache+xml");
  expectType(/^xl\/timelines\/timeline\d+\.xml$/, "application/vnd.ms-excel.timeline+xml");
  expectType(/^xl\/timelineCaches\/timelineCache\d+\.xml$/, "application/vnd.ms-excel.timelineCache+xml");
  for (const n of names.filter((x) => x.startsWith("xl/media/"))) {
    const want = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", gif: "image/gif", wdp: "image/vnd.ms-photo" }[n.split(".").pop()!.toLowerCase()];
    if (want && defaults.get(n.split(".").pop()!.toLowerCase()) !== want) bad(`${n}: the Default content type for the extension should be ${want}`);
  }
  return problems;
}
