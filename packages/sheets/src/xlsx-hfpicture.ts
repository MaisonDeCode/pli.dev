import { attr, child, childrenNamed, type XmlElement } from "@pli.dev/core";
import { readImage, sniffImage, toDataUri, type ImageType } from "./image";
import type { HeaderFooterPicture, HeaderFooterPictures, HeaderFooterSection, Sheet } from "./model";
import { cleanHeaderPicture } from "./page";

/*
 * Pictures in headers and footers, in an .xlsx file. The text of a header or footer has `&G` where a picture goes, and the
 * sheet's `legacyDrawingHF` points at a VML drawing with one shape for each picture; the shape's id says where it belongs
 * (`LH` left header, `CH`, `RH`, `LF`, `CF`, `RF`, with `EVEN` or `FIRST` on the end for the even pages' and the first page's),
 * its style holds the size, and its `imagedata` names a picture file in the drawing's relationships.
 */

const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const EXTENSION: Record<ImageType, string> = { png: "png", jpeg: "jpeg", gif: "gif" };

const PLACES: [HeaderFooterSection, string][] = [
  ["header", ""], ["footer", ""], ["evenHeader", "EVEN"], ["evenFooter", "EVEN"], ["firstHeader", "FIRST"], ["firstFooter", "FIRST"],
];

/** The shape id for a picture: where it sits and in which header or footer. */
export const hfShapeId = (section: HeaderFooterSection, at: "left" | "center" | "right"): string => {
  const [, suffix] = PLACES.find(([s]) => s === section)!;
  return `${at === "left" ? "L" : at === "center" ? "C" : "R"}${/Header$|^header$/.test(section) ? "H" : "F"}${suffix}`;
};

/** The section and place a shape id names, or null. */
export function hfShapePlace(id: string): { section: HeaderFooterSection; at: "left" | "center" | "right" } | null {
  const m = /^([LCR])([HF])(.*)$/i.exec(id.trim());
  if (!m) return null;
  const rest = m[3]!.toUpperCase();
  const header = m[2]!.toUpperCase() === "H";
  const kind = rest.startsWith("E") ? "even" : rest.startsWith("F") ? "first" : "";
  const section = (kind ? `${kind}${header ? "Header" : "Footer"}` : header ? "header" : "footer") as HeaderFooterSection;
  return { section, at: m[1]!.toUpperCase() === "L" ? "left" : m[1]!.toUpperCase() === "C" ? "center" : "right" };
}

export interface HfFiles {
  drawing: string;
  /** The relationships of the drawing, which point at the picture files. */
  rels: string;
  media: { name: string; bytes: Uint8Array; type: ImageType }[];
}

const fixed = (v: number) => `${Math.round(v * 65536)}f`;

/** The drawing and picture files for a sheet's header and footer pictures, or null when it has none. `firstMedia` numbers the picture files. */
export function hfPictureFiles(sheet: Sheet, firstMedia: number, block: number): HfFiles | null {
  const pictures = sheet.page?.pictures;
  if (!pictures) return null;
  const media: HfFiles["media"] = [];
  const rels: string[] = [];
  const shapes: string[] = [];
  let z = 0;
  for (const [section] of PLACES) {
    for (const at of ["left", "center", "right"] as const) {
      const pic = pictures[section]?.[at];
      if (!pic) continue;
      const { type, bytes } = readImage(pic.src);
      const name = `image${firstMedia + media.length}.${EXTENSION[type]}`;
      media.push({ name, bytes, type });
      const rid = `rId${media.length}`;
      rels.push(`<Relationship Id="${rid}" Type="${NS_R}/image" Target="../media/${name}"/>`);
      const c = pic.crop ?? {};
      const crop = [["cropleft", c.left], ["croptop", c.top], ["cropright", c.right], ["cropbottom", c.bottom]].filter(([, v]) => v).map(([k, v]) => ` ${k}="${fixed(v as number)}"`).join("");
      z++;
      shapes.push(
        `<v:shape id="${hfShapeId(section, at)}" o:spid="_x0000_s${block * 1024 + z}" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:0;width:${pic.width}pt;height:${pic.height}pt;z-index:${z}">` +
          `<v:imagedata o:relid="${rid}" o:title="${esc(pic.alt ?? "")}"${crop}${pic.grayscale ? ' grayscale="t"' : ""}/><o:lock v:ext="edit" rotation="t"/></v:shape>`,
      );
    }
  }
  if (!media.length) return null;
  const drawing =
    `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">` +
    `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${block}"/></o:shapelayout>` +
    `<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/>` +
    `<v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas>` +
    `<v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>` +
    shapes.join("") +
    `</xml>`;
  return { drawing, rels: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`, media };
}

/** A length in a VML style (`100pt`, `1.5in`, `2cm`, `40px`) as points. */
function points(text: string | undefined): number | undefined {
  const m = /^\s*(-?\d*\.?\d+)\s*(pt|in|cm|mm|px)?\s*$/i.exec(text ?? "");
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] ?? "px").toLowerCase();
  return unit === "pt" ? n : unit === "in" ? n * 72 : unit === "cm" ? (n * 72) / 2.54 : unit === "mm" ? (n * 72) / 25.4 : n * 0.75;
}

/** A VML crop (`6554f` is a fraction of 65536ths; `10%` a percent; a plain number a fraction) as a fraction. */
function fraction(text: string | undefined): number {
  if (!text) return 0;
  const t = text.trim();
  const n = parseFloat(t);
  if (!Number.isFinite(n)) return 0;
  const v = t.endsWith("f") ? n / 65536 : t.endsWith("%") ? n / 100 : n;
  return Math.max(0, Math.min(0.95, v));
}

/**
 * The pictures a header-and-footer drawing holds. `target` gives the picture file a relationship id of the drawing points at,
 * as bytes. Pictures that can't be read are skipped, and counted in the second part.
 */
export function readHfPictures(vml: XmlElement | undefined, target: (id: string) => Uint8Array | undefined): { pictures: HeaderFooterPictures; skipped: number } {
  const pictures: HeaderFooterPictures = {};
  let skipped = 0;
  const walk = (el: XmlElement | undefined): void => {
    for (const shape of childrenNamed(el, "shape")) {
      const place = hfShapePlace(attr(shape, "id") ?? "");
      const data = child(shape, "imagedata");
      const bytes = data ? target(attr(data, "relid", "o") ?? attr(data, "id", "r") ?? "") : undefined;
      const info = bytes ? sniffImage(bytes) : null;
      if (!place || !data || !bytes || !info) {
        if (data) skipped++;
        continue;
      }
      const style = Object.fromEntries((attr(shape, "style") ?? "").split(";").map((d) => d.split(":").map((x) => x.trim())).filter((d) => d.length === 2) as [string, string][]);
      const width = points(style["width"]) ?? info.width * 0.75;
      const height = points(style["height"]) ?? info.height * 0.75;
      const crop = { left: fraction(attr(data, "cropleft")), top: fraction(attr(data, "croptop")), right: fraction(attr(data, "cropright")), bottom: fraction(attr(data, "cropbottom")) };
      const gray = /^(t|true|1)$/i.test(attr(data, "grayscale") ?? "");
      const alt = attr(data, "title");
      let pic: HeaderFooterPicture;
      try {
        pic = cleanHeaderPicture({ src: toDataUri(bytes, info.type), width: Math.max(1, width), height: Math.max(1, height), ...(Object.values(crop).some(Boolean) ? { crop: Object.fromEntries(Object.entries(crop).filter(([, v]) => v)) } : {}), ...(gray ? { grayscale: true as const } : {}), ...(alt ? { alt } : {}) });
      } catch {
        skipped++;
        continue;
      }
      (pictures[place.section] ??= {})[place.at] = pic;
    }
    for (const sub of el?.children ?? []) if (typeof sub !== "string" && sub.name !== "shape") walk(sub);
  };
  walk(vml);
  return { pictures, skipped };
}
