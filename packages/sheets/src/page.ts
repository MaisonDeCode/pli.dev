import { PliError } from "@pli.dev/core";
import { parseRange, rangeAddress } from "./address";
import { readImage } from "./image";
import { MAX_COLS, MAX_ROWS, type HeaderFooterParts, type HeaderFooterPicture, type HeaderFooterPictures, type PageSetup, type PaperSize } from "./model";

/** Paper sizes, in inches, upright, with the code Excel gives each in a file. */
export const PAPER_SIZES: Record<PaperSize, { width: number; height: number; code: number; label: string }> = {
  letter: { width: 8.5, height: 11, code: 1, label: "Letter (8.5 × 11 in)" },
  tabloid: { width: 11, height: 17, code: 3, label: "Tabloid (11 × 17 in)" },
  legal: { width: 8.5, height: 14, code: 5, label: "Legal (8.5 × 14 in)" },
  executive: { width: 7.25, height: 10.5, code: 7, label: "Executive (7.25 × 10.5 in)" },
  a3: { width: 297 / 25.4, height: 420 / 25.4, code: 8, label: "A3 (297 × 420 mm)" },
  a4: { width: 210 / 25.4, height: 297 / 25.4, code: 9, label: "A4 (210 × 297 mm)" },
  a5: { width: 148 / 25.4, height: 210 / 25.4, code: 11, label: "A5 (148 × 210 mm)" },
};

/** The margins a sheet starts with, in inches (Excel's "Normal"). */
export const DEFAULT_MARGINS = { top: 0.75, bottom: 0.75, left: 0.7, right: 0.7, header: 0.3, footer: 0.3 } as const;

export const MIN_SCALE = 10;
export const MAX_SCALE = 400;
/** Excel's limit on the text of a header or footer. */
export const MAX_HEADER_LENGTH = 255;

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

const SECTIONS = ["header", "footer", "firstHeader", "firstFooter", "evenHeader", "evenFooter"] as const;

function cleanParts(name: string, parts: HeaderFooterParts): HeaderFooterParts | undefined {
  if (!parts || typeof parts !== "object") return bad(`A ${name} is left, middle and right text`);
  const out: HeaderFooterParts = {};
  for (const k of ["left", "center", "right"] as const) {
    const v = parts[k];
    if (v === undefined || v === "") continue;
    if (typeof v !== "string") bad(`The ${k} of a ${name} is text`);
    if ((v as string).length > MAX_HEADER_LENGTH) bad(`A ${name} can be at most ${MAX_HEADER_LENGTH} characters in each part`);
    out[k] = v as string;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The most a picture in a header or footer may measure across or high, in points (22 inches). */
export const MAX_HEADER_PICTURE = 1584;

/** A picture for a header or footer made ready to keep, or an error that says what is wrong. */
export function cleanHeaderPicture(p: HeaderFooterPicture): HeaderFooterPicture {
  if (!p || typeof p !== "object") return bad("A picture in a header or footer is an object with a src, width and height");
  readImage(p.src);
  for (const n of [p.width, p.height]) if (typeof n !== "number" || !(n >= 1 && n <= MAX_HEADER_PICTURE)) bad(`A picture in a header or footer is 1 to ${MAX_HEADER_PICTURE} points across and high`);
  const out: HeaderFooterPicture = { src: p.src, width: Math.round(p.width * 100) / 100, height: Math.round(p.height * 100) / 100 };
  if (p.crop !== undefined) {
    const crop: NonNullable<HeaderFooterPicture["crop"]> = {};
    for (const [k, v] of Object.entries(p.crop ?? {}) as [string, number | undefined][]) {
      if (!["left", "top", "right", "bottom"].includes(k)) bad(`"${k}" isn't a side of a picture`);
      if (v === undefined || v === 0) continue;
      if (typeof v !== "number" || !(v > 0 && v < 1)) bad("A crop is a fraction of the picture from 0 to 1");
      crop[k as "left"] = Math.round(v * 10000) / 10000;
    }
    if ((crop.left ?? 0) + (crop.right ?? 0) >= 1 || (crop.top ?? 0) + (crop.bottom ?? 0) >= 1) bad("A crop can't leave nothing of the picture");
    if (Object.keys(crop).length) out.crop = crop;
  }
  if (p.grayscale !== undefined && p.grayscale !== (false as never)) {
    if (p.grayscale !== true) bad("grayscale is true or false");
    out.grayscale = true;
  }
  if (p.alt !== undefined && p.alt !== "") {
    if (typeof p.alt !== "string" || p.alt.length > 1000) bad("A picture's description is text of at most 1000 characters");
    out.alt = p.alt;
  }
  for (const k of Object.keys(p)) if (!["src", "width", "height", "crop", "grayscale", "alt"].includes(k)) bad(`"${k}" isn't part of a picture in a header or footer`);
  return out;
}

/** What the picture needs in a header or footer: its size on paper from the pixels it has, or one or both sizes asked for (the other follows, keeping its shape), or a percent of its own size. */
export function headerPictureFrom(src: string, size: { width?: number; height?: number; scale?: number } = {}): HeaderFooterPicture {
  const info = readImage(src);
  const naturalW = info.width * 0.75;
  const naturalH = info.height * 0.75;
  let width = naturalW;
  let height = naturalH;
  if (size.scale !== undefined) {
    if (!(size.scale > 0)) bad("A picture's scale is a percent above 0");
    width = (naturalW * size.scale) / 100;
    height = (naturalH * size.scale) / 100;
  } else if (size.width !== undefined && size.height !== undefined) {
    width = size.width;
    height = size.height;
  } else if (size.width !== undefined) {
    width = size.width;
    height = (naturalH * size.width) / naturalW;
  } else if (size.height !== undefined) {
    height = size.height;
    width = (naturalW * size.height) / naturalH;
  }
  return cleanHeaderPicture({ src, width, height });
}

/** A picture in a header or footer made bigger or smaller: by a percent, or to a width or height (the other follows unless `lockAspect` is false). */
export function scaleHeaderPicture(p: HeaderFooterPicture, size: { percent?: number; width?: number; height?: number; lockAspect?: boolean }): HeaderFooterPicture {
  let { width, height } = p;
  const lock = size.lockAspect !== false;
  if (size.percent !== undefined) {
    if (!(size.percent > 0)) bad("A scale is a percent above 0");
    width = (p.width * size.percent) / 100;
    height = (p.height * size.percent) / 100;
  } else {
    if (size.width !== undefined) {
      if (lock && size.height === undefined) height = (p.height * size.width) / p.width;
      width = size.width;
    }
    if (size.height !== undefined) {
      if (lock && size.width === undefined) width = (p.width * size.height) / p.height;
      height = size.height;
    }
  }
  return cleanHeaderPicture({ ...p, width, height });
}

/** A header or footer text with the `&G` picture code in it (put at the end when there isn't one), or taken out. */
export function withPictureCode(text: string | undefined, on: boolean): string {
  const t = text ?? "";
  const found: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== "&") continue;
    const next = t[i + 1];
    if (next === "G" || next === "g") found.push(i);
    else if (next === '"') {
      const end = t.indexOf('"', i + 2);
      i = end < 0 ? t.length : end;
      continue;
    } else if (next === "K") i += 6;
    i++;
  }
  if (on) return found.length ? t : `${t}&G`;
  let out = t;
  for (const at of found.reverse()) out = out.slice(0, at) + out.slice(at + 2);
  return out;
}

function cleanPictures(pictures: HeaderFooterPictures): HeaderFooterPictures | undefined {
  if (!pictures || typeof pictures !== "object") return bad("The pictures of a header and footer are an object");
  const out: HeaderFooterPictures = {};
  for (const [section, parts] of Object.entries(pictures)) {
    if (!(SECTIONS as readonly string[]).includes(section)) bad(`"${section}" isn't a header or footer`);
    if (parts === undefined) continue;
    const kept: NonNullable<HeaderFooterPictures["header"]> = {};
    for (const [at, pic] of Object.entries(parts ?? {})) {
      if (at !== "left" && at !== "center" && at !== "right") bad(`"${at}" isn't left, center or right`);
      if (pic === undefined) continue;
      kept[at as "left"] = cleanHeaderPicture(pic);
    }
    if (Object.keys(kept).length) out[section as "header"] = kept;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A sort of the numbers in a list of break positions, kept to those that are inside the sheet. */
const breaks = (name: string, list: number[], max: number): number[] | undefined => {
  if (!Array.isArray(list)) return bad(`${name} is a list of numbers`);
  for (const n of list) if (!Number.isInteger(n) || n < 1 || n >= max) bad(`${name} are whole numbers from 1 to ${max - 1}`);
  const out = [...new Set(list)].sort((a, b) => a - b);
  return out.length ? out : undefined;
};

const span = (name: string, v: [number, number], max: number): [number, number] => {
  if (!Array.isArray(v) || v.length !== 2 || !Number.isInteger(v[0]) || !Number.isInteger(v[1]) || v[0] < 1 || v[1] < v[0] || v[1] > max) return bad(`${name} is a first and last number from 1 to ${max}`);
  return [v[0], v[1]];
};

/** A page setup made ready to keep, with whatever is the default left out; null when nothing is left. */
export function cleanPageSetup(page: PageSetup): PageSetup | null {
  if (!page || typeof page !== "object") return bad("A page setup is an object");
  const out: PageSetup = {};
  if (page.orientation !== undefined) {
    if (page.orientation !== "landscape") bad('The orientation is "landscape" (or left out for portrait)');
    out.orientation = "landscape";
  }
  if (page.paper !== undefined && page.paper !== "letter") {
    if (!(page.paper in PAPER_SIZES)) bad(`The paper is one of ${Object.keys(PAPER_SIZES).join(", ")}`);
    out.paper = page.paper;
  }
  if (page.fit !== undefined) {
    const { wide, tall } = page.fit ?? {};
    for (const n of [wide, tall]) if (!Number.isInteger(n) || n < 0 || n > 32767) bad("Fit to a number of pages is 0 (as many as needed) to 32767");
    out.fit = { wide, tall };
  } else if (page.scale !== undefined && page.scale !== 100) {
    if (!Number.isFinite(page.scale) || page.scale < MIN_SCALE || page.scale > MAX_SCALE) bad(`The scale is ${MIN_SCALE} to ${MAX_SCALE} percent`);
    out.scale = Math.round(page.scale);
  }
  if (page.margins) {
    const m: NonNullable<PageSetup["margins"]> = {};
    for (const [k, v] of Object.entries(page.margins) as [keyof typeof DEFAULT_MARGINS, number | undefined][]) {
      if (!(k in DEFAULT_MARGINS)) bad(`"${k}" isn't a margin`);
      if (v === undefined) continue;
      if (!Number.isFinite(v) || v < 0 || v > 10) bad("A margin is 0 to 10 inches");
      if (Math.abs(v - DEFAULT_MARGINS[k]) > 1e-9) m[k] = Math.round(v * 1000) / 1000;
    }
    if (Object.keys(m).length) out.margins = m;
  }
  for (const k of ["centerHorizontally", "centerVertically", "gridlines", "headings", "blackAndWhite", "draft", "differentFirstPage", "differentOddEven"] as const) {
    if (page[k] === undefined || page[k] === (false as never)) continue;
    if (page[k] !== true) bad(`${k} is true or false`);
    out[k] = true;
  }
  if (page.comments !== undefined) {
    if (page.comments !== "end" && page.comments !== "sheet") bad('Comments print "end" (after the sheet) or "sheet" (as displayed), or are left out');
    out.comments = page.comments;
  }
  if (page.errors !== undefined) {
    if (page.errors !== "blank" && page.errors !== "dash" && page.errors !== "na") bad('Errors print as "blank", "dash" or "na", or are left out to print as they show');
    out.errors = page.errors;
  }
  if (page.pictures !== undefined) {
    const pictures = cleanPictures(page.pictures);
    if (pictures) out.pictures = pictures;
  }
  if (page.order !== undefined && page.order !== ("down" as never)) {
    if (page.order !== "over") bad('The page order is "over" (across first) or "down"');
    out.order = "over";
  }
  if (page.firstPageNumber !== undefined && page.firstPageNumber !== 1) {
    if (!Number.isInteger(page.firstPageNumber) || page.firstPageNumber < 0 || page.firstPageNumber > 32767) bad("The first page number is a whole number up to 32767");
    out.firstPageNumber = page.firstPageNumber;
  }
  if (page.printArea !== undefined) {
    if (!Array.isArray(page.printArea)) bad("The print area is a list of ranges");
    const ranges = page.printArea.map((r) => {
      const b = parseRange(String(r).replace(/\$/g, "").toUpperCase());
      if (!b) bad(`"${String(r)}" isn't a range such as A1:D20`);
      return rangeAddress(b!);
    });
    if (ranges.length) out.printArea = ranges;
  }
  if (page.titleRows !== undefined) out.titleRows = span("The rows to repeat", page.titleRows, MAX_ROWS);
  if (page.titleCols !== undefined) out.titleCols = span("The columns to repeat", page.titleCols, MAX_COLS);
  if (page.rowBreaks !== undefined) {
    const b = breaks("Row page breaks", page.rowBreaks, MAX_ROWS);
    if (b) out.rowBreaks = b;
  }
  if (page.colBreaks !== undefined) {
    const b = breaks("Column page breaks", page.colBreaks, MAX_COLS);
    if (b) out.colBreaks = b;
  }
  for (const k of SECTIONS) {
    if (page[k] === undefined) continue;
    const parts = cleanParts(k.replace(/([A-Z])/g, " $1").toLowerCase(), page[k]!);
    if (parts) out[k] = parts;
  }
  const allowed = new Set<string>(["orientation", "paper", "scale", "fit", "margins", "centerHorizontally", "centerVertically", "gridlines", "headings", "order", "blackAndWhite", "draft", "comments", "errors", "pictures", "firstPageNumber", "printArea", "titleRows", "titleCols", "rowBreaks", "colBreaks", ...SECTIONS, "differentFirstPage", "differentOddEven"]);
  for (const k of Object.keys(page)) if (!allowed.has(k)) bad(`"${k}" isn't part of a page setup`);
  return Object.keys(out).length ? out : null;
}

/** The sheet's margins in inches, with the defaults filled in. */
export function marginsOf(page: PageSetup | undefined): Record<keyof typeof DEFAULT_MARGINS, number> {
  return { ...DEFAULT_MARGINS, ...page?.margins };
}

/** The paper in points (72 to the inch) after turning it round for landscape. */
export function paperPoints(page: PageSetup | undefined): { width: number; height: number } {
  const p = PAPER_SIZES[page?.paper ?? "letter"];
  const w = p.width * 72;
  const h = p.height * 72;
  return page?.orientation === "landscape" ? { width: h, height: w } : { width: w, height: h };
}

/** The page-setup fields for rows such as `1:2` and columns such as `A:B` to repeat; `null` for none, and a field left out is left alone. */
export function parsePrintTitles(titles: { rows?: string | null; cols?: string | null }): { titleRows?: [number, number] | null; titleCols?: [number, number] | null } {
  const out: { titleRows?: [number, number] | null; titleCols?: [number, number] | null } = {};
  if (titles.rows !== undefined) {
    const m = titles.rows === null ? null : /^\$?(\d+)(?::\$?(\d+))?$/.exec(titles.rows.trim());
    if (titles.rows !== null && !m) bad(`"${titles.rows}" isn't rows such as 1:2`);
    out.titleRows = m ? [Number(m[1]), Number(m[2] ?? m[1])] : null;
  }
  if (titles.cols !== undefined) {
    const m = titles.cols === null ? null : /^\$?([A-Za-z]{1,3})(?::\$?([A-Za-z]{1,3}))?$/.exec(titles.cols.trim());
    if (titles.cols !== null && !m) bad(`"${titles.cols}" isn't columns such as A:B`);
    const n = (letters: string) => [...letters.toUpperCase()].reduce((acc, c) => acc * 26 + c.charCodeAt(0) - 64, 0);
    out.titleCols = m ? [n(m[1]!), n((m[2] ?? m[1])!)] : null;
  }
  return out;
}
