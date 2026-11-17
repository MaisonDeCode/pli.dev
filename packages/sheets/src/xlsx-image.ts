import { attr, child, childrenNamed, createId, elements, type XmlElement } from "@pli.dev/core";
import { applyArtistic, scaleDown } from "./artistic";
import { decodeJxr, encodeJxr, isJxr, WDP_CONTENT_TYPE, WDP_RELATIONSHIP } from "./jxr";
import { decodeImage } from "./pixels";
import { encodePng } from "./png";
import { axisAtPx, axisOffsetPx, cleanCrop, cleanImage, imageBox, MAX_IMAGE_BYTES, readImage, sniffImage, toDataUri, type ImageType } from "./image";
import { SHAPE_ADJUSTMENTS, cleanShapeAdjust, shapeOfPreset } from "./image-shape";
import { ARTISTIC, ARTISTIC_KINDS, DEFAULT_GLOW, DEFAULT_REFLECTION, artisticLevel } from "./image-effects";
import type { ArtisticKind, ImageCrop, ImagePlacement, Sheet, SheetImage } from "./model";
import { anchorBox, relsPathOf, resolve, slicerNameIn } from "./xlsx-chart";

/*
 * Pictures in an .xlsx file: an anchor in the sheet's drawing holding a `pic`, whose `blip` names a relationship of the
 * drawing that points at a file in `xl/media`. How a picture follows its cells is the kind of anchor (a one-cell anchor moves
 * but keeps its size, a two-cell anchor `editAs` `twoCell` moves and sizes, `absolute` does neither); cropping is the blip's
 * `srcRect`, rotation and flips are on the shape's `xfrm`. The border is the shape's line; glow, shadow, reflection and soft edges are its
 * `effectLst`; the shape it is cropped to is the picture's preset geometry (`prstGeom`). An artistic effect is Excel's own extension (`a14:imgProps`): the blip holds the picture as the effect draws it and
 * the layer holds the original, with the effect to apply to it, as an HD Photo (JPEG XR, `jxr.ts`) file: the only form of
 * original Excel keeps (it dropped the effect when the layer was a PNG).
 */

const EMU = 9525;
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** The kinds of file in `xl/media`: the pictures, and the HD Photo (`.wdp`) that holds the original of a picture with an artistic effect. */
export type MediaType = ImageType | "wdp";
export const IMAGE_CONTENT_TYPES: Record<MediaType, string> = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", wdp: WDP_CONTENT_TYPE };
const EXTENSION: Record<MediaType, string> = { png: "png", jpeg: "jpeg", gif: "gif", wdp: "wdp" };

/** The names of the theme colours in a `schemeClr`, as the places in a theme's colour list. */
const SCHEME: Record<string, number> = { lt1: 0, bg1: 0, dk1: 1, tx1: 1, lt2: 2, bg2: 2, dk2: 3, tx2: 3, accent1: 4, accent2: 5, accent3: 6, accent4: 7, accent5: 8, accent6: 9 };
const OFFICE = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];

/** The A element's colour as `#rrggbb`, and its alpha from 0 to 1 (1 when it says none): `srgbClr`, or a `schemeClr` read in the theme without its tints. */
function colourIn(el: XmlElement | undefined, theme: readonly string[]): { color: string; alpha: number } | undefined {
  const rgb = child(el, "srgbClr");
  const scheme = child(el, "schemeClr");
  const hex = rgb ? attr(rgb, "val") : theme[SCHEME[attr(scheme, "val") ?? ""] ?? -1];
  const holder = rgb ?? scheme;
  if (!hex || !/^[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  const alpha = Number(attr(child(holder, "alpha"), "val"));
  return { color: `#${hex.toLowerCase()}`, alpha: Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha / 100000)) : 1 };
}

type Look = Pick<SheetImage, "border" | "shadow" | "brightness" | "contrast" | "grayscale" | "glow" | "softEdge" | "reflection">;

/** The border, effects and corrections a picture in a drawing has. A colour from the theme is read as the theme's plain colour (its tints and shades are not applied). */
function readLook(pic: XmlElement, theme: readonly string[]): Look {
  const out: Look = {};
  const spPr = child(pic, "spPr");
  const ln = child(spPr, "ln");
  const line = colourIn(child(ln, "solidFill"), theme);
  if (ln && line) {
    const w = Number(ln.attrs["w"]);
    const dash = attr(child(ln, "prstDash"), "val");
    out.border = {
      color: line.color,
      ...(Number.isFinite(w) && w > 0 ? { width: Math.max(0.25, Math.min(20, Math.round((w / 12700) * 100) / 100)) } : {}),
      ...(dash && dash !== "solid" ? { dash: dash === "sysDot" || dash === "dot" || dash === "sysDash" ? ("dot" as const) : ("dash" as const) } : {}),
    };
  }
  const effects = child(spPr, "effectLst");
  const shade = child(effects, "outerShdw");
  if (shade) {
    const c = colourIn(shade, theme);
    const num = (k: string) => Number(shade.attrs[k]);
    if (c) {
      out.shadow = {
        color: c.color,
        ...(Number.isFinite(num("blurRad")) ? { blur: Math.max(0, Math.min(100, Math.round(num("blurRad") / EMU))) } : {}),
        ...(Number.isFinite(num("dist")) ? { distance: Math.max(0, Math.min(100, Math.round(num("dist") / EMU))) } : {}),
        ...(Number.isFinite(num("dir")) ? { angle: num("dir") / 60000 } : {}),
        opacity: c.alpha,
      };
    }
  }
  const glow = child(effects, "glow");
  if (glow) {
    const c = colourIn(glow, theme);
    const rad = Number(glow.attrs["rad"]);
    if (c) out.glow = { color: c.color, radius: Math.max(0, Math.min(100, Number.isFinite(rad) ? Math.round((rad / EMU) * 100) / 100 : 0)), opacity: c.alpha };
  }
  const soft = Number(child(effects, "softEdge")?.attrs["rad"]);
  if (Number.isFinite(soft) && soft > 0) out.softEdge = Math.min(100, Math.round((soft / EMU) * 100) / 100);
  const mirror = child(effects, "reflection");
  if (mirror) {
    const part = (k: string, usual: number) => (mirror.attrs[k] !== undefined && Number.isFinite(Number(mirror.attrs[k])) ? Number(mirror.attrs[k]) : usual);
    out.reflection = {
      blur: Math.max(0, Math.min(50, part("blurRad", 0) / EMU)),
      startOpacity: Math.max(0, Math.min(1, part("stA", 100000) / 100000)),
      endOpacity: Math.max(0, Math.min(1, part("endA", 0) / 100000)),
      distance: Math.max(0, Math.min(100, part("dist", 0) / EMU)),
      size: Math.max(0.01, Math.min(1, part("endPos", 100000) / 100000)),
    };
  }
  const blip = child(child(pic, "blipFill"), "blip");
  const lum = child(blip, "lum");
  const level = (k: string) => {
    const v = Number(lum?.attrs[k]);
    return Number.isFinite(v) ? Math.max(-1, Math.min(1, v / 100000)) : 0;
  };
  if (level("bright")) out.brightness = level("bright");
  if (level("contrast")) out.contrast = level("contrast");
  if (child(blip, "grayscl")) out.grayscale = true;
  return out;
}

const NS_A14 = "http://schemas.microsoft.com/office/drawing/2010/main";
/** The `uri` of the extension that holds a picture's `imgProps` (its artistic effects). */
const IMG_PROPS_URI = "{BEBA8EAE-BF5A-486C-A8C5-ECC9F3942E4B}";
/** The `uri` of the extension Office writes after it, saying the picture's own resolution is not used. */
const USE_LOCAL_DPI_URI = "{28A0092B-C50C-407E-A947-70E740481C1C}";
const KIND_OF_ELEMENT = new Map(ARTISTIC_KINDS.map((k) => [ARTISTIC[k].element, k] as const));

/** The effects of a blip's `a14:imgProps`: the layer holding the original, and the artistic effect (if Pli draws it) or the name of one it doesn't. */
function readArtistic(blip: XmlElement | undefined): { layer?: string; kind?: ArtisticKind; level?: number; other?: string } | undefined {
  const ext = childrenNamed(child(blip, "extLst"), "ext").find((e) => e.attrs["uri"]?.toUpperCase() === IMG_PROPS_URI);
  const layer = child(child(ext, "imgProps"), "imgLayer");
  if (!layer) return undefined;
  const effect = child(layer, "imgEffect");
  const el = effect?.children.find((c): c is XmlElement => typeof c !== "string" && /^artistic/.test(c.name));
  if (!el) return { layer: attr(layer, "embed", "r") };
  const kind = KIND_OF_ELEMENT.get(el.name);
  if (!kind) return { layer: attr(layer, "embed", "r"), other: el.name.replace(/^artistic/, "") };
  const range = ARTISTIC[kind];
  const raw = Number(el.attrs[range.attribute]);
  return { layer: attr(layer, "embed", "r"), kind, ...(Number.isFinite(raw) ? { level: Math.max(range.min, Math.min(range.max, Math.round(raw))) } : {}) };
}

/** The pixels of an HD Photo file as the bytes of a PNG, or null when they can't be read. */
function pngOfJxr(bytes: Uint8Array): Uint8Array | null {
  const pic = decodeJxr(bytes);
  return pic ? encodePng(pic) : null;
}

/** The shape's adjustments as Office's guides: `<a:gd name="adj" fmla="val 25000"/>`. */
function avLst(image: SheetImage): string {
  const entries = image.shape && image.shapeAdjust ? Object.entries(image.shapeAdjust) : [];
  return entries.length ? `<a:avLst>${entries.map(([name, v]) => `<a:gd name="${name}" fmla="val ${Math.round(v)}"/>`).join("")}</a:avLst>` : "<a:avLst/>";
}

/** The adjustments a `prstGeom` holds (`<a:gd name="adj" fmla="val 25000"/>`), for the shape; only those the shape has, and not the usual ones. */
function readAdjust(geom: XmlElement | undefined, shape: NonNullable<SheetImage["shape"]>): Record<string, number> | undefined {
  const raw: Record<string, number> = {};
  for (const gd of childrenNamed(child(geom, "avLst"), "gd")) {
    const m = /^val\s+(-?\d+)$/.exec(gd.attrs["fmla"] ?? "");
    if (m && gd.attrs["name"]) raw[gd.attrs["name"]] = Number(m[1]);
  }
  const known: Record<string, number> = {};
  const names = SHAPE_ADJUSTMENTS[shape]?.specs.map((x) => x.name) ?? [];
  for (const [k, v] of Object.entries(raw)) if (names.includes(k)) known[k] = v;
  try {
    return cleanShapeAdjust(shape, known);
  } catch {
    return undefined;
  }
}

/** A crop as the `l`, `t`, `r` and `b` of a `srcRect`: thousandths of a percent of the picture's own size. */
const cropAttrs = (crop: ImageCrop): string => (["l", "t", "r", "b"] as const).map((k, i) => ((v) => (v ? ` ${k}="${Math.round(v * 100000)}"` : ""))(crop[(["left", "top", "right", "bottom"] as const)[i]!])).join("");

export interface ImageFiles {
  /** The anchors to add to the sheet's drawing. */
  anchors: string;
  /** Relationships of the drawing, one for each picture. */
  rels: string[];
  /** The files for `xl/media`, numbered from where the caller says. */
  media: { name: string; bytes: Uint8Array; type: MediaType }[];
}

/** What a sheet's pictures need written. `firstRel` is the number of the first relationship id free in the drawing, `firstMedia` the number of the first media file. */
export function sheetImageFiles(sheet: Sheet, firstRel: number, firstMedia: number): ImageFiles | null {
  const all = sheet.images ?? [];
  if (!all.length) return null;
  const out: ImageFiles = { anchors: "", rels: [], media: [] };
  /** Adds a file to `xl/media` with a relationship to it, and gives the relationship's id. An HD Photo is `hdphotoN.wdp`, with the relationship Office gives it. */
  const addMedia = (bytes: Uint8Array, type: MediaType): string => {
    const name = `${type === "wdp" ? "hdphoto" : "image"}${firstMedia + out.media.length}.${EXTENSION[type]}`;
    const rid = `rId${firstRel + out.rels.length}`;
    out.media.push({ name, bytes, type });
    out.rels.push(`<Relationship Id="${rid}" Type="${type === "wdp" ? WDP_RELATIONSHIP : `${NS_R}/image`}" Target="../media/${name}"/>`);
    return rid;
  };
  all.forEach((image, i) => {
    const label = `Picture ${i + 1}`;
    const { type, bytes } = readImage(image.src);
    // An artistic effect is in the file twice, as Excel writes it: the picture as the effect draws it (the blip, a PNG), and the
    // original with the effect (the layer, an HD Photo file, which is the only form of picture Excel takes there). A picture the
    // pixel readers can't read is written plain.
    const original = image.artistic ? decodeImage(bytes) : null;
    const baked = original && image.artistic ? encodePng(applyArtistic(scaleDown(original), image.artistic)) : null;
    const rid = baked ? addMedia(baked, "png") : addMedia(bytes, type);
    const layerRid = baked && original ? addMedia(encodeJxr(original), "wdp") : undefined;
    const box = imageBox(sheet, image);
    const cx = Math.round(box.width * EMU);
    const cy = Math.round(box.height * EMU);
    const from = `<xdr:from><xdr:col>${image.from.col - 1}</xdr:col><xdr:colOff>${Math.round((image.from.dx ?? 0) * EMU)}</xdr:colOff><xdr:row>${image.from.row - 1}</xdr:row><xdr:rowOff>${Math.round((image.from.dy ?? 0) * EMU)}</xdr:rowOff></xdr:from>`;
    const corner = (axis: "col" | "row", px: number) => axisAtPx(sheet, axis, px);
    const c2 = corner("col", box.left + box.width);
    const r2 = corner("row", box.top + box.height);
    const to = `<xdr:to><xdr:col>${c2.index - 1}</xdr:col><xdr:colOff>${Math.round(c2.off * EMU)}</xdr:colOff><xdr:row>${r2.index - 1}</xdr:row><xdr:rowOff>${Math.round(r2.off * EMU)}</xdr:rowOff></xdr:to>`;
    const crop = image.crop ? `<a:srcRect${cropAttrs(image.crop)}/>` : "";
    const xfrm = `<a:xfrm${image.rotation ? ` rot="${Math.round(image.rotation * 60000)}"` : ""}${image.flipH ? ' flipH="1"' : ""}${image.flipV ? ' flipV="1"' : ""}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
    const blipKids = `${image.grayscale ? "<a:grayscl/>" : ""}${image.brightness || image.contrast ? `<a:lum${image.brightness ? ` bright="${Math.round(image.brightness * 100000)}"` : ""}${image.contrast ? ` contrast="${Math.round(image.contrast * 100000)}"` : ""}/>` : ""}`;
    const layer =
      baked && image.artistic
        ? `<a:extLst><a:ext uri="${IMG_PROPS_URI}"><a14:imgProps xmlns:a14="${NS_A14}"><a14:imgLayer r:embed="${layerRid}"><a14:imgEffect><a14:${ARTISTIC[image.artistic.kind].element} ${ARTISTIC[image.artistic.kind].attribute}="${artisticLevel(image.artistic)}"/></a14:imgEffect></a14:imgLayer></a14:imgProps></a:ext><a:ext uri="${USE_LOCAL_DPI_URI}"><a14:useLocalDpi xmlns:a14="${NS_A14}" val="0"/></a:ext></a:extLst>`
        : "";
    const blip = `<a:blip xmlns:r="${NS_R}" r:embed="${rid}"${blipKids || layer ? `>${blipKids}${layer}</a:blip>` : "/>"}`;
    const line = image.border
      ? `<a:ln w="${Math.round((image.border.width ?? 1) * 12700)}"><a:solidFill><a:srgbClr val="${image.border.color.slice(1).toUpperCase()}"/></a:solidFill><a:prstDash val="${image.border.dash === "dot" ? "sysDot" : image.border.dash === "dash" ? "dash" : "solid"}"/></a:ln>`
      : "";
    const hexOf = (c: string) => c.slice(1).toUpperCase();
    const glow = image.glow
      ? `<a:glow rad="${Math.round((image.glow.radius ?? DEFAULT_GLOW.radius) * EMU)}"><a:srgbClr val="${hexOf(image.glow.color ?? DEFAULT_GLOW.color)}"><a:alpha val="${Math.round((image.glow.opacity ?? DEFAULT_GLOW.opacity) * 100000)}"/></a:srgbClr></a:glow>`
      : "";
    const mirror = image.reflection
      ? `<a:reflection blurRad="${Math.round((image.reflection.blur ?? DEFAULT_REFLECTION.blur) * EMU)}" stA="${Math.round((image.reflection.startOpacity ?? DEFAULT_REFLECTION.startOpacity) * 100000)}" endA="${Math.round((image.reflection.endOpacity ?? DEFAULT_REFLECTION.endOpacity) * 100000)}" endPos="${Math.round((image.reflection.size ?? DEFAULT_REFLECTION.size) * 100000)}" dist="${Math.round((image.reflection.distance ?? DEFAULT_REFLECTION.distance) * EMU)}" dir="5400000" fadeDir="5400000" sx="100000" sy="-100000" kx="0" ky="0" algn="bl" rotWithShape="1"/>`
      : "";
    const soft = image.softEdge ? `<a:softEdge rad="${Math.round(image.softEdge * EMU)}"/>` : "";
    const shade = image.shadow
      ? `<a:outerShdw blurRad="${Math.round((image.shadow.blur ?? 6) * EMU)}" dist="${Math.round((image.shadow.distance ?? 4) * EMU)}" dir="${Math.round((image.shadow.angle ?? 45) * 60000)}" algn="ctr" rotWithShape="0"><a:srgbClr val="${(image.shadow.color ?? "#000000").slice(1).toUpperCase()}"><a:alpha val="${Math.round((image.shadow.opacity ?? 0.4) * 100000)}"/></a:srgbClr></a:outerShdw>`
      : "";
    // The effects go in the order the schema has them: glow, shadow, reflection, soft edges.
    const effects = glow || shade || mirror || soft ? `<a:effectLst>${glow}${shade}${mirror}${soft}</a:effectLst>` : "";
    const pic =
      `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${1000 + i}" name="${label}"${image.alt ? ` descr="${esc(image.alt)}"` : ""}/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
      `<xdr:blipFill>${blip}${crop}<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
      `<xdr:spPr>${xfrm}<a:prstGeom prst="${image.shape ?? "rect"}">${avLst(image)}</a:prstGeom>${line}${effects}</xdr:spPr></xdr:pic><xdr:clientData/>`;
    if (image.placement === "size" || image.placement === "free") out.anchors += `<xdr:twoCellAnchor editAs="${image.placement === "size" ? "twoCell" : "absolute"}">${from}${to}${pic}</xdr:twoCellAnchor>`;
    else out.anchors += `<xdr:oneCellAnchor>${from}<xdr:ext cx="${cx}" cy="${cy}"/>${pic}</xdr:oneCellAnchor>`;
  });
  return out;
}

/**
 * The pictures a worksheet's drawing holds. `xml` reads an XML part of the file, `bytes` any part. A picture in a format that
 * isn't kept (anything but PNG, JPEG and GIF), one that is too big, and one whose file is missing are left out and said so.
 */
export function readSheetImages(sheetPath: string, drawingId: string, sheet: Sheet, xml: (path: string) => XmlElement | undefined, bytes: (path: string) => Uint8Array | undefined, warnings: Set<string>, theme: readonly string[] = OFFICE): SheetImage[] {
  const sheetRels = xml(relsPathOf(sheetPath));
  const drawingTarget = childrenNamed(sheetRels, "Relationship").find((r) => r.attrs["Id"] === drawingId)?.attrs["Target"];
  if (!drawingTarget) return [];
  const drawingPath = resolve(sheetPath, drawingTarget);
  const drawing = xml(drawingPath);
  if (!drawing) return [];
  const drawingRels = xml(relsPathOf(drawingPath));
  const out: SheetImage[] = [];
  let left = 0;
  for (const anchor of elements(drawing)) {
    if (slicerNameIn(anchor) !== undefined) continue;
    const pic = child(anchor, "pic");
    if (!pic) continue;
    const blipEl = child(child(pic, "blipFill"), "blip");
    const embed = attr(blipEl, "embed", "r");
    const target = embed ? childrenNamed(drawingRels, "Relationship").find((r) => r.attrs["Id"] === embed)?.attrs["Target"] : undefined;
    let data = target ? bytes(resolve(drawingPath, target)) : undefined;
    // An artistic effect: the blip is the picture as Excel drew it. When the layer holds the original in a form we read (not Excel's own .wdp) and the effect is one Pli draws, the original is the picture and the effect is kept on it; otherwise the drawn picture stays.
    let artistic: SheetImage["artistic"];
    const art = readArtistic(blipEl);
    if (art) {
      const layerTarget = art.layer ? childrenNamed(drawingRels, "Relationship").find((r) => r.attrs["Id"] === art.layer)?.attrs["Target"] : undefined;
      const original = layerTarget ? bytes(resolve(drawingPath, layerTarget)) : undefined;
      // The layer is an HD Photo file when Excel wrote it (its pixels become a PNG); a PNG, JPEG or GIF is taken as it is.
      const layer = original && isJxr(original) ? pngOfJxr(original) : original;
      if (art.kind && layer && layer.length <= MAX_IMAGE_BYTES && sniffImage(layer)) {
        data = layer;
        artistic = { kind: art.kind, ...(art.level !== undefined ? { level: art.level } : {}) };
      } else if (art.kind || art.other) warnings.add("Some pictures have an artistic effect Pli can't redraw (Excel keeps the original in a form Pli doesn't read, or the effect isn't one Pli has); they are kept as Excel drew them");
    }
    if (!data) {
      left++;
      continue;
    }
    const info = data.length <= MAX_IMAGE_BYTES ? sniffImage(data) : null;
    if (!info) {
      left++;
      continue;
    }
    let { col, row, dx, dy } = anchorBox(anchor, sheet);
    const { width, height } = anchorBox(anchor, sheet);
    const fit = (n: number, natural: number) => (Number.isFinite(n) && n >= 1 ? Math.min(4000, Math.round(n)) : natural);
    const alt = attr(child(child(pic, "nvPicPr"), "cNvPr"), "descr");
    // How it follows its cells: a two-cell anchor says so itself, the others by their kind.
    const placement: ImagePlacement | undefined =
      anchor.name === "twoCellAnchor" ? (anchor.attrs["editAs"] === "oneCell" ? undefined : anchor.attrs["editAs"] === "absolute" ? "free" : "size") : anchor.name === "absoluteAnchor" ? "free" : undefined;
    if (anchor.name === "absoluteAnchor") {
      // The anchor holds a distance from the sheet's corner; the picture is placed by the cell that is there.
      const c = axisAtPx(sheet, "col", dx);
      const r = axisAtPx(sheet, "row", dy);
      col = c.index;
      row = r.index;
      dx = c.off;
      dy = r.off;
    }
    const w = fit(width, info.width);
    const h = fit(height, info.height);
    let to: SheetImage["to"];
    if (placement === "size") {
      const left = axisOffsetPx(sheet, "col", Math.max(1, col)) + dx;
      const top = axisOffsetPx(sheet, "row", Math.max(1, row)) + dy;
      const c = axisAtPx(sheet, "col", left + w);
      const r = axisAtPx(sheet, "row", top + h);
      to = { row: r.index, col: c.index, ...(Math.round(c.off) ? { dx: Math.round(c.off) } : {}), ...(Math.round(r.off) ? { dy: Math.round(r.off) } : {}) };
    }
    const xfrm = child(child(pic, "spPr"), "xfrm");
    const rot = Number(xfrm?.attrs["rot"] ?? 0) / 60000;
    const rect = child(child(pic, "blipFill"), "srcRect");
    let crop: ImageCrop | null = null;
    if (rect) {
      const part = (k: string) => Math.max(0, Math.min(0.99, Number(rect.attrs[k] ?? 0) / 100000 || 0));
      try {
        crop = cleanCrop({ left: part("l"), top: part("t"), right: part("r"), bottom: part("b") });
      } catch {
        crop = null;
      }
    }
    const look = readLook(pic, theme);
    const preset = attr(child(child(pic, "spPr"), "prstGeom"), "prst");
    const shape = shapeOfPreset(preset);
    const shapeAdjust = shape ? readAdjust(child(child(pic, "spPr"), "prstGeom"), shape) : undefined;
    if (preset && preset !== "rect" && !shape) warnings.add("Some pictures are cropped to a shape Pli doesn't have (a cloud, a banner…); they show as rectangles");
    try {
      out.push(
        cleanImage({
          id: createId("image_"),
          src: toDataUri(data, info.type),
          from: { row: Math.max(1, row), col: Math.max(1, col), ...(dx > 0.5 ? { dx: Math.round(dx) } : {}), ...(dy > 0.5 ? { dy: Math.round(dy) } : {}) },
          width: w,
          height: h,
          ...(alt ? { alt: alt.slice(0, 1000) } : {}),
          ...(placement ? { placement } : {}),
          ...(to ? { to } : {}),
          ...(Number.isFinite(rot) && rot % 360 !== 0 ? { rotation: rot } : {}),
          ...(xfrm?.attrs["flipH"] === "1" || xfrm?.attrs["flipH"] === "true" ? { flipH: true as const } : {}),
          ...(xfrm?.attrs["flipV"] === "1" || xfrm?.attrs["flipV"] === "true" ? { flipV: true as const } : {}),
          ...(crop ? { crop } : {}),
          ...look,
          ...(artistic ? { artistic } : {}),
          ...(shape ? { shape } : {}),
          ...(shapeAdjust ? { shapeAdjust } : {}),
        }),
      );
    } catch {
      left++;
    }
  }
  if (left) warnings.add("Some pictures are in a format Pli doesn't keep (only PNG, JPEG and GIF are), or are too big, and were left out");
  return out;
}
