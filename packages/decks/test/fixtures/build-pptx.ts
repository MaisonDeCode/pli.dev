import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/**
 * Test-side helpers that assemble small .pptx packages from XML strings (nothing binary is checked in). The three
 * fixtures mimic what PowerPoint and Google Slides write, with invented neutral text.
 */

export const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
export const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export type Parts = Record<string, string | Uint8Array>;

/** A 1x1 PNG. */
export const PNG_1X1 = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

export const xml = (body: string): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`;

export interface RelSpec {
  id: string;
  type: string;
  target: string;
  external?: boolean;
}

export function rels(items: RelSpec[]): string {
  return xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
      .map((r) => `<Relationship Id="${r.id}" Type="${r.type.startsWith("http") ? r.type : `${REL}/${r.type}`}" Target="${r.target}"${r.external ? ' TargetMode="External"' : ""}/>`)
      .join("")}</Relationships>`,
  );
}

/** Zips parts into a package, adding `[Content_Types].xml` and the root relationships when they are not given. */
export function pptx(parts: Parts, kind: "presentation" | "template" | "show" = "presentation"): Uint8Array {
  const main = { presentation: "presentation.main", template: "template.main", show: "slideshow.main" }[kind];
  const all: Parts = { ...parts };
  all["[Content_Types].xml"] ??= xml(
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${main}+xml"/></Types>`,
  );
  all["_rels/.rels"] ??= rels([{ id: "rId1", type: "officeDocument", target: "ppt/presentation.xml" }]);
  const files: Record<string, Uint8Array> = {};
  // The content types and presentation come first, the way a writer would.
  const order = Object.keys(all).sort((a, b) => rank(a) - rank(b));
  for (const name of order) {
    const v = all[name]!;
    files[name] = typeof v === "string" ? strToU8(v) : v;
  }
  return zipSync(files);
}

const rank = (name: string): number => (name === "[Content_Types].xml" ? 0 : name === "_rels/.rels" ? 1 : name.startsWith("ppt/presentation") || name.startsWith("ppt/_rels/presentation") ? 2 : 3);

// ---- Building blocks ---------------------------------------------------------------------------------------------

export const xfrm = (x: number, y: number, w: number, h: number, attrs = ""): string => `<a:xfrm${attrs ? ` ${attrs}` : ""}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;

export const run = (text: string, rPr = "", inner = ""): string => `<a:r><a:rPr lang="en-US"${rPr ? ` ${rPr}` : ""}${inner ? `>${inner}</a:rPr>` : "/>"}<a:t>${text}</a:t></a:r>`;

export const para = (text: string, pPr = "", rPr = "", inner = ""): string => `<a:p>${pPr ? `<a:pPr ${pPr}/>` : ""}${run(text, rPr, inner)}</a:p>`;

export const txBody = (paras: string, bodyPr = "<a:bodyPr/>", lst = "<a:lstStyle/>"): string => `<p:txBody>${bodyPr}${lst}${paras}</p:txBody>`;

export function sp(id: number, name: string, opts: { ph?: string; spPr?: string; tx?: string; style?: string; cNvSpPr?: string } = {}): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr${opts.cNvSpPr ? ` ${opts.cNvSpPr}` : ""}/><p:nvPr>${opts.ph ?? ""}</p:nvPr></p:nvSpPr><p:spPr>${opts.spPr ?? ""}</p:spPr>${opts.style ?? ""}${opts.tx ?? ""}</p:sp>`;
}

export const tree = (inner: string): string =>
  `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${inner}</p:spTree>`;

/** A `p:cSld` holding a shape tree. */
export const spTree = (inner: string): string => `<p:cSld>${tree(inner)}</p:cSld>`;

export function pic(id: number, name: string, rid: string, box: [number, number, number, number], extra = "", descr = ""): string {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}"${descr ? ` descr="${descr}"` : ""}/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/>${extra}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(...box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

const root = (tag: string, attrs: string, inner: string): string => xml(`<${tag} ${NS}${attrs ? ` ${attrs}` : ""}>${inner}</${tag}>`);

/** The element list a notes page needs, with the slide's notes text in the body placeholder. */
export function notesSlide(text: string[]): string {
  return root(
    "p:notes",
    "",
    spTree(
      sp(2, "Slide Image Placeholder 1", { ph: '<p:ph type="sldImg"/>', spPr: "" }) +
        sp(3, "Notes Placeholder 2", { ph: '<p:ph type="body" idx="1"/>', spPr: "", tx: txBody(text.map((t) => para(t)).join("")) }) +
        sp(4, "Slide Number Placeholder 3", { ph: '<p:ph type="sldNum" sz="quarter" idx="5"/>', spPr: "", tx: txBody(`<a:p><a:fld id="{00000000-0000-0000-0000-000000000001}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld></a:p>`) }),
    ) + "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>",
  );
}

// ---- Theme -------------------------------------------------------------------------------------------------------

const fmtScheme = `<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme>`;

export interface ThemeSpec {
  name: string;
  colors: [string, string, string, string, string, string, string, string, string, string, string, string];
  major: string;
  minor: string;
  /** PowerPoint writes dk1/lt1 as system colours. */
  sys?: boolean;
}

export function themeXml(t: ThemeSpec): string {
  const [dk1, lt1, dk2, lt2, a1, a2, a3, a4, a5, a6, hl, fh] = t.colors;
  const c = (tag: string, v: string) => `<a:${tag}><a:srgbClr val="${v}"/></a:${tag}>`;
  const dk = t.sys ? `<a:dk1><a:sysClr val="windowText" lastClr="${dk1}"/></a:dk1>` : c("dk1", dk1);
  const lt = t.sys ? `<a:lt1><a:sysClr val="window" lastClr="${lt1}"/></a:lt1>` : c("lt1", lt1);
  return xml(
    `<a:theme xmlns:a="${NS_A}" name="${t.name}"><a:themeElements><a:clrScheme name="${t.name}">${dk}${lt}${c("dk2", dk2)}${c("lt2", lt2)}${c("accent1", a1)}${c("accent2", a2)}${c("accent3", a3)}${c("accent4", a4)}${c("accent5", a5)}${c("accent6", a6)}${c("hlink", hl)}${c("folHlink", fh)}</a:clrScheme><a:fontScheme name="${t.name}"><a:majorFont><a:latin typeface="${t.major}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${t.minor}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>${fmtScheme}</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`,
  );
}

const STD_MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

const presentationRels = (masterCount: number, slideCount: number, extra: RelSpec[] = []): string =>
  rels([
    ...Array.from({ length: masterCount }, (_, i) => ({ id: `rId${i + 1}`, type: "slideMaster", target: `slideMasters/slideMaster${i + 1}.xml` })),
    ...Array.from({ length: slideCount }, (_, i) => ({ id: `rId${masterCount + i + 1}`, type: "slide", target: `slides/slide${i + 1}.xml` })),
    { id: `rId${masterCount + slideCount + 1}`, type: "theme", target: "theme/theme1.xml" },
    ...extra,
  ]);

function presentationXml(opts: { cx: number; cy: number; masters: number; slides: number; defaults?: string; notesSz?: boolean }): string {
  const sldIds = Array.from({ length: opts.slides }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${opts.masters + i + 1}"/>`).join("");
  const mIds = Array.from({ length: opts.masters }, (_, i) => `<p:sldMasterId id="${2147483648 + i * 100}" r:id="rId${i + 1}"/>`).join("");
  return root(
    "p:presentation",
    'saveSubsetFonts="1"',
    `<p:sldMasterIdLst>${mIds}</p:sldMasterIdLst>${opts.slides ? `<p:sldIdLst>${sldIds}</p:sldIdLst>` : ""}<p:sldSz cx="${opts.cx}" cy="${opts.cy}"/><p:notesSz cx="6858000" cy="9144000"/>${opts.defaults ?? ""}`,
  );
}

// ---- 1. A PowerPoint-style template -------------------------------------------------------------------------------

const POWERPOINT_DEFAULTS = `<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle>`;

const bodyLvl = (n: number, marL: number, sz: number) =>
  `<a:lvl${n}pPr marL="${marL}" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:buChar char="•"/><a:defRPr sz="${sz}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${n}pPr>`;

export const POWERPOINT_TITLE = "Quarterly review";

/** A .potx made the way PowerPoint writes one: bgRef, clrMap, txStyles, two layouts, a decoration, and two sample slides. */
export function powerpointTemplate(): Uint8Array {
  const theme = themeXml({ name: "Office Theme", sys: true, major: "Calibri Light", minor: "Calibri", colors: ["000000", "FFFFFF", "44546A", "E7E6E6", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"] });
  const promptTitle = `<a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master title style</a:t></a:r></a:p>`;
  const promptBody = ["Click to edit Master text styles", "Second level", "Third level"].map((t, i) => `<a:p><a:pPr lvl="${i}"/><a:r><a:rPr lang="en-US"/><a:t>${t}</a:t></a:r></a:p>`).join("");
  const field = `<a:p><a:fld id="{B1A4F29C-0000-4000-8000-000000000002}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p>`;
  const footers = (leftIdx: number) =>
    sp(leftIdx, "Date Placeholder", { ph: '<p:ph type="dt" sz="half" idx="10"/>', spPr: "", tx: txBody(`<a:p><a:endParaRPr lang="en-US"/></a:p>`) }) +
    sp(leftIdx + 1, "Footer Placeholder", { ph: '<p:ph type="ftr" sz="quarter" idx="11"/>', spPr: "", tx: txBody(`<a:p><a:endParaRPr lang="en-US"/></a:p>`) }) +
    sp(leftIdx + 2, "Slide Number Placeholder", { ph: '<p:ph type="sldNum" sz="quarter" idx="12"/>', spPr: "", tx: txBody(field) });

  const master = root(
    "p:sldMaster",
    "",
    `<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${tree(
      sp(7, "Accent bar", { spPr: `${xfrm(0, 6400800, 12192000, 457200)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln><a:noFill/></a:ln>`, tx: txBody(`<a:p><a:endParaRPr lang="en-US"/></a:p>`) }) +
        sp(2, "Title Placeholder 1", {
          ph: '<p:ph type="title"/>',
          spPr: `${xfrm(838200, 365125, 10515600, 1325563)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`,
          tx: txBody(promptTitle, '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"><a:normAutofit/></a:bodyPr>'),
        }) +
        sp(3, "Text Placeholder 2", {
          ph: '<p:ph type="body" idx="1"/>',
          spPr: `${xfrm(838200, 1825625, 10515600, 4351338)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`,
          tx: txBody(promptBody, '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"><a:normAutofit/></a:bodyPr>'),
        }) +
        sp(4, "Date", { ph: '<p:ph type="dt" sz="half" idx="2"/>', spPr: `${xfrm(838200, 6356350, 2743200, 365125)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`, tx: txBody(`<a:p><a:endParaRPr lang="en-US"/></a:p>`, '<a:bodyPr anchor="ctr"/>', `<a:lstStyle><a:lvl1pPr algn="l"><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle>`) }) +
        sp(5, "Footer", { ph: '<p:ph type="ftr" sz="quarter" idx="3"/>', spPr: `${xfrm(4038600, 6356350, 4114800, 365125)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`, tx: txBody(`<a:p><a:endParaRPr lang="en-US"/></a:p>`, '<a:bodyPr anchor="ctr"/>', `<a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle>`) }) +
        sp(6, "Slide Number", { ph: '<p:ph type="sldNum" sz="quarter" idx="4"/>', spPr: `${xfrm(8610600, 6356350, 2743200, 365125)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`, tx: txBody(field, '<a:bodyPr anchor="ctr"/>', `<a:lstStyle><a:lvl1pPr algn="r"><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle>`) }),
    )}</p:cSld>${STD_MAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle>${bodyLvl(1, 228600, 2800)}${bodyLvl(2, 685800, 2400)}${bodyLvl(3, 1143000, 2000)}</p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles>`,
  );

  const layout1 = root(
    "p:sldLayout",
    'type="title" preserve="1"',
    `<p:cSld name="Title Slide">${tree(
      sp(2, "Title 1", {
        ph: '<p:ph type="ctrTitle"/>',
        spPr: `${xfrm(1524000, 1122363, 9144000, 2387600)}`,
        tx: txBody(promptTitle, '<a:bodyPr anchor="b"/>', `<a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="6000"/></a:lvl1pPr></a:lstStyle>`),
      }) +
        sp(3, "Subtitle 2", {
          ph: '<p:ph type="subTitle" idx="1"/>',
          spPr: `${xfrm(1524000, 3602038, 9144000, 1655762)}`,
          tx: txBody(`<a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master subtitle style</a:t></a:r></a:p>`, "<a:bodyPr/>", `<a:lstStyle><a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="2400"/></a:lvl1pPr></a:lstStyle>`),
        }) +
        footers(4),
    )}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`,
  );

  const layout2 = root(
    "p:sldLayout",
    'type="obj" preserve="1"',
    `<p:cSld name="Title and Content">${tree(
      sp(2, "Title 1", { ph: '<p:ph type="title"/>', spPr: "", tx: txBody(promptTitle) }) +
        sp(3, "Content Placeholder 2", { ph: '<p:ph idx="1"/>', spPr: "", tx: txBody(promptBody) }) +
        footers(4),
    )}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`,
  );

  const slide1 = root(
    "p:sld",
    "",
    `${spTree(
      sp(2, "Title 1", { ph: '<p:ph type="ctrTitle"/>', spPr: "", tx: txBody(para(POWERPOINT_TITLE)) }) +
        sp(3, "Subtitle 2", { ph: '<p:ph type="subTitle" idx="1"/>', spPr: "", tx: txBody(para("Example Corp")) }),
    )}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`,
  );

  const slide2 = root(
    "p:sld",
    "",
    `${spTree(
      sp(2, "Title 1", { ph: '<p:ph type="title"/>', spPr: "", tx: txBody(para("Highlights")) }) +
        sp(3, "Content Placeholder 2", {
          ph: '<p:ph idx="1"/>',
          spPr: "",
          tx: txBody(para("Revenue grew steadily") + para("Two new regions opened", 'lvl="1"') + para("Support response time improved"), "<a:bodyPr><a:normAutofit fontScale=\"92500\" lnSpcReduction=\"10000\"/></a:bodyPr>"),
        }) +
        sp(4, "Rounded Rectangle 3", {
          spPr: `${xfrm(8001000, 4572000, 2743200, 1143000)}<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>`,
          style: `<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>`,
          tx: txBody(para("Up 12%", 'algn="ctr"'), '<a:bodyPr rtlCol="0" anchor="ctr"/>'),
        }) +
        pic(5, "Picture 4", "rId3", [1000000, 4572000, 1143000, 1143000], '<a:srcRect l="10000" t="5000" r="10000" b="5000"/>', "Sample chart image"),
    )}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14"><p:transition spd="slow" p14:dur="2000"><p:fade/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`,
  );

  const slide3 = root("p:sld", 'show="0"', `${spTree(sp(2, "Title 1", { ph: '<p:ph type="title"/>', spPr: "", tx: txBody(para("Appendix")) }))}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr><p:transition advTm="5000"><p:push dir="u"/></p:transition>`);

  return pptx(
    {
      "ppt/presentation.xml": presentationXml({ cx: 12192000, cy: 6858000, masters: 1, slides: 3, defaults: POWERPOINT_DEFAULTS }),
      "ppt/_rels/presentation.xml.rels": presentationRels(1, 3),
      "ppt/theme/theme1.xml": theme,
      "ppt/slideMasters/slideMaster1.xml": master,
      "ppt/slideMasters/_rels/slideMaster1.xml.rels": rels([
        { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
        { id: "rId2", type: "slideLayout", target: "../slideLayouts/slideLayout2.xml" },
        { id: "rId3", type: "theme", target: "../theme/theme1.xml" },
      ]),
      "ppt/slideLayouts/slideLayout1.xml": layout1,
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels([{ id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" }]),
      "ppt/slideLayouts/slideLayout2.xml": layout2,
      "ppt/slideLayouts/_rels/slideLayout2.xml.rels": rels([{ id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" }]),
      "ppt/slides/slide1.xml": slide1,
      "ppt/slides/_rels/slide1.xml.rels": rels([{ id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" }]),
      "ppt/slides/slide2.xml": slide2,
      "ppt/slides/_rels/slide2.xml.rels": rels([
        { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout2.xml" },
        { id: "rId2", type: "notesSlide", target: "../notesSlides/notesSlide1.xml" },
        { id: "rId3", type: "image", target: "../media/image1.png" },
      ]),
      "ppt/slides/slide3.xml": slide3,
      "ppt/slides/_rels/slide3.xml.rels": rels([{ id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout2.xml" }]),
      "ppt/notesSlides/notesSlide1.xml": notesSlide(["Mention the new regions.", "Keep it under two minutes."]),
      "ppt/notesSlides/_rels/notesSlide1.xml.rels": rels([{ id: "rId1", type: "slide", target: "../slides/slide2.xml" }]),
      "ppt/media/image1.png": PNG_1X1,
    },
    "template",
  );
}

// ---- 2. A Google Slides export ------------------------------------------------------------------------------------

export const GOOGLE_COLORS = { dk1: "1B1F2A", lt1: "FFFFFF", dk2: "2B3140", lt2: "D9DCE3" };

/** A dark Google-Slides-style export: capitalised layout names, absolute placeholders, Roboto, a clrMap that swaps bg1/tx1. */
export function googleExport(): Uint8Array {
  const theme = themeXml({ name: "Simple Dark", major: "Roboto", minor: "Roboto", colors: ["1B1F2A", "FFFFFF", "2B3140", "D9DCE3", "4285F4", "EA4335", "FBBC04", "34A853", "FF6D01", "46BDC6", "8AB4F8", "C58AF9"] });
  const darkMap = '<p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
  const gLvl = (n: number, sz: number) =>
    `<a:lvl${n}pPr marL="${457200 * n}" lvl="${n - 1}" indent="-342900" algn="l" rtl="0"><a:lnSpc><a:spcPct val="115000"/></a:lnSpc><a:spcBef><a:spcPts val="${n === 1 ? 0 : 1600}"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft><a:buClr><a:schemeClr val="lt2"/></a:buClr><a:buSzPts val="${sz}"/><a:buChar char="●"/><a:defRPr sz="${sz}"><a:solidFill><a:schemeClr val="lt2"/></a:solidFill><a:latin typeface="Roboto"/><a:ea typeface="Roboto"/><a:cs typeface="Roboto"/><a:sym typeface="Roboto"/></a:defRPr></a:lvl${n}pPr>`;
  const titleLvl = `<a:lvl1pPr lvl="0" algn="l" rtl="0"><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft><a:buNone/><a:defRPr sz="3600" b="1"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill><a:latin typeface="Roboto"/><a:ea typeface="Roboto"/><a:cs typeface="Roboto"/><a:sym typeface="Roboto"/></a:defRPr></a:lvl1pPr>`;
  const bodyPrG = (anchor: string, extra = "") => `<a:bodyPr spcFirstLastPara="1" wrap="square" lIns="91425" tIns="91425" rIns="91425" bIns="91425" anchor="${anchor}" anchorCtr="0"><a:noAutofit/></a:bodyPr>${extra}`;
  const emptyP = `<a:p><a:endParaRPr/></a:p>`;
  const rect = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln>';

  const master = root(
    "p:sldMaster",
    "",
    `<p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="dk1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>${tree(
      sp(2, "Google Shape;2;p1", { ph: '<p:ph type="title"/>', spPr: `${xfrm(457200, 457200, 8229600, 857400)}${rect}`, tx: `<p:txBody>${bodyPrG("t")}<a:lstStyle><a:lvl1pPr lvl="0"><a:defRPr sz="3600" b="1"/></a:lvl1pPr></a:lstStyle>${emptyP}</p:txBody>` }) +
        sp(3, "Google Shape;3;p1", { ph: '<p:ph type="body" idx="1"/>', spPr: `${xfrm(457200, 1428750, 8229600, 3086100)}${rect}`, tx: `<p:txBody>${bodyPrG("t")}<a:lstStyle/>${emptyP}</p:txBody>` }) +
        sp(4, "Google Shape;4;p1", { ph: '<p:ph type="sldNum" idx="12"/>', spPr: `${xfrm(8472458, 4663217, 548700, 393600)}${rect}`, tx: `<p:txBody>${bodyPrG("ctr")}<a:lstStyle><a:lvl1pPr lvl="0" algn="r"><a:defRPr sz="1000"/></a:lvl1pPr></a:lstStyle><a:p><a:pPr/><a:fld id="{00000000-1234-1234-1234-123412341234}" type="slidenum"><a:rPr lang="en"/><a:t>‹#›</a:t></a:fld><a:endParaRPr/></a:p></p:txBody>` }),
    )}</p:cSld>${darkMap}<p:sldLayoutIdLst>${[1, 2, 3, 4, 5, 6, 7].map((i) => `<p:sldLayoutId id="${2147483648 + i}" r:id="rId${i}"/>`).join("")}</p:sldLayoutIdLst><p:txStyles><p:titleStyle>${titleLvl}</p:titleStyle><p:bodyStyle>${gLvl(1, 1800)}${gLvl(2, 1600)}${gLvl(3, 1400)}</p:bodyStyle><p:otherStyle><a:defPPr marR="0" lvl="0" algn="l" rtl="0"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:defPPr></p:otherStyle></p:txStyles>`,
  );

  const layoutShell = (type: string, name: string, inner: string, bg = "", attrs = "") =>
    root("p:sldLayout", `type="${type}" ${attrs}`.trim(), `<p:cSld name="${name}">${bg}${tree(inner)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`);
  const ph = (id: number, phTag: string, box: [number, number, number, number], anchor = "t", lst = "<a:lstStyle/>") => sp(id, `Google Shape;${id};p`, { ph: phTag, spPr: `${xfrm(...box)}${rect}`, tx: `<p:txBody>${bodyPrG(anchor)}${lst}${emptyP}</p:txBody>` });

  const gradientBg = `<p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="dk1"/></a:gs><a:gs pos="100000"><a:schemeClr val="dk2"/></a:gs></a:gsLst><a:lin ang="5400012" scaled="0"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>`;
  const layouts: Record<string, string> = {
    "slideLayout1.xml": layoutShell("title", "TITLE", ph(11, '<p:ph type="ctrTitle"/>', [311700, 1500000, 8520600, 1100000], "b", `<a:lstStyle><a:lvl1pPr lvl="0" algn="ctr"><a:defRPr sz="5200"/></a:lvl1pPr></a:lstStyle>`) + ph(12, '<p:ph type="subTitle" idx="1"/>', [311700, 2700000, 8520600, 800000], "t", `<a:lstStyle><a:lvl1pPr lvl="0" algn="ctr"><a:buNone/><a:defRPr sz="2400"/></a:lvl1pPr></a:lstStyle>`), gradientBg),
    "slideLayout2.xml": layoutShell("secHead", "SECTION_HEADER", ph(21, '<p:ph type="title"/>', [311700, 1800000, 5000000, 700000], "b") + ph(22, '<p:ph type="body" idx="1"/>', [311700, 2600000, 5000000, 900000])),
    "slideLayout3.xml": layoutShell("tx", "TITLE_AND_BODY", ph(31, '<p:ph type="title"/>', [311700, 445025, 8520600, 572700]) + ph(32, '<p:ph type="body" idx="1"/>', [311700, 1152475, 8520600, 3416400])),
    "slideLayout4.xml": layoutShell("twoColTx", "TITLE_AND_TWO_COLUMNS", ph(41, '<p:ph type="title"/>', [311700, 445025, 8520600, 572700]) + ph(42, '<p:ph type="body" idx="1"/>', [311700, 1152475, 4152900, 3416400]) + ph(43, '<p:ph type="body" idx="2"/>', [4679400, 1152475, 4152900, 3416400])),
    "slideLayout5.xml": layoutShell("titleOnly", "TITLE_ONLY", ph(51, '<p:ph type="title"/>', [311700, 445025, 8520600, 572700])),
    "slideLayout6.xml": layoutShell("blank", "BLANK", ""),
    // A layout with a picture and no placeholders: the picture is a decoration.
    "slideLayout7.xml": layoutShell("blank", "CUSTOM_1", pic(61, "Google Shape;61;p", "rId2", [7772400, 228600, 914400, 914400]), "", ""),
  };

  const tableCell = (text: string, fill = "") => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${para(text, "", 'sz="1200"')}</a:txBody><a:tcPr marL="91425" marR="91425" marT="91425" marB="91425" anchor="ctr">${fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : "<a:noFill/>"}</a:tcPr></a:tc>`;
  const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="30" name="Google Shape;30;p3"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="311700" y="3000000"/><a:ext cx="4114800" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid><a:gridCol w="2057400"/><a:gridCol w="2057400"/></a:tblGrid><a:tr h="457200">${tableCell("Region", "4285F4")}${tableCell("Sales", "4285F4")}</a:tr><a:tr h="457200">${tableCell("North")}${tableCell("120")}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="40" name="Google Shape;40;p3"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="5000000" y="3000000"/><a:ext cx="2000000" cy="1000000"/><a:chOff x="0" y="0"/><a:chExt cx="1000000" cy="500000"/></a:xfrm></p:grpSpPr>${sp(41, "Google Shape;41;p3", { spPr: `${xfrm(0, 0, 500000, 500000)}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent2"/></a:solidFill><a:ln><a:noFill/></a:ln>` })}${sp(42, "Google Shape;42;p3", { spPr: `${xfrm(500000, 0, 500000, 500000)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent4"/></a:solidFill><a:ln><a:noFill/></a:ln>`, tx: txBody(para("Group", 'algn="ctr"'), '<a:bodyPr anchor="ctr"/>') })}</p:grpSp>`;
  const line = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="50" name="Google Shape;50;p3"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm flipV="1"><a:off x="311700" y="2800000"/><a:ext cx="3000000" cy="100000"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="19050" cap="flat" cmpd="sng"><a:solidFill><a:schemeClr val="accent3"/></a:solidFill><a:prstDash val="dash"/><a:round/><a:headEnd type="none" w="med" len="med"/><a:tailEnd type="triangle" w="med" len="med"/></a:ln></p:spPr></p:cxnSp>`;

  const slide1 = root(
    "p:sld",
    "",
    `${spTree(
      sp(2, "Google Shape;55;p13", { ph: '<p:ph type="ctrTitle"/>', spPr: `${xfrm(311700, 1500000, 8520600, 1100000)}`, tx: `<p:txBody>${bodyPrG("b")}<a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en"/><a:t>Annual plan</a:t></a:r></a:p></p:txBody>` }) +
        sp(3, "Google Shape;56;p13", { ph: '<p:ph type="subTitle" idx="1"/>', spPr: `${xfrm(311700, 2700000, 8520600, 800000)}`, tx: `<p:txBody>${bodyPrG("t")}<a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en"/><a:t>Prepared by Example Corp</a:t></a:r></a:p></p:txBody>` }),
    )}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`,
  );
  const slide2 = root(
    "p:sld",
    "",
    `${spTree(
      sp(2, "Google Shape;60;p3", { ph: '<p:ph type="title"/>', spPr: "", tx: `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en"/><a:t>Goals</a:t></a:r></a:p></p:txBody>` }) +
        sp(3, "Google Shape;61;p3", {
          ph: '<p:ph type="body" idx="1"/>',
          spPr: `${xfrm(311700, 1152475, 8520600, 1500000)}`,
          tx: `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr marL="457200" lvl="0" indent="-342900" algn="l" rtl="0"><a:lnSpc><a:spcPct val="115000"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft><a:buSzPts val="1800"/><a:buChar char="●"/></a:pPr><a:r><a:rPr lang="en" sz="1800"/><a:t>Grow the </a:t></a:r><a:r><a:rPr lang="en" sz="1800" u="sng"><a:solidFill><a:schemeClr val="hlink"/></a:solidFill><a:hlinkClick r:id="rId3"/></a:rPr><a:t>community</a:t></a:r><a:endParaRPr sz="1800"/></a:p><a:p><a:pPr marL="914400" lvl="1" indent="-317500" algn="l" rtl="0"><a:spcBef><a:spcPts val="1600"/></a:spcBef><a:buSzPts val="1400"/><a:buChar char="○"/></a:pPr><a:r><a:rPr lang="en" sz="1400"/><a:t>Host four events</a:t></a:r><a:br><a:rPr lang="en" sz="1400"/></a:br><a:r><a:rPr lang="en" sz="1400"/><a:t>and two workshops</a:t></a:r><a:endParaRPr sz="1400"/></a:p></p:txBody>`,
        }) +
        line +
        table +
        group,
    )}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`,
  );
  // A slide on the picture layout, with a text box, a freeform and a chart that cannot be imported.
  const slide3 = root(
    "p:sld",
    "",
    `${spTree(
      sp(2, "Google Shape;70;p4", { cNvSpPr: 'txBox="1"', spPr: `${xfrm(457200, 1000000, 4000000, 600000)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>`, tx: txBody(para("Plain text box", "", 'sz="2000"', '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:latin typeface="Roboto"/>'), '<a:bodyPr wrap="square" anchor="t"><a:spAutoFit/></a:bodyPr>') }) +
        sp(3, "Google Shape;71;p4", { spPr: `${xfrm(457200, 2000000, 1000000, 1000000)}<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="50"/></a:lnTo><a:lnTo><a:pt x="0" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom><a:solidFill><a:srgbClr val="FBBC04"/></a:solidFill>` }) +
        `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart 3"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="2000000" y="2000000"/><a:ext cx="3000000" cy="2000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId9"/></a:graphicData></a:graphic></p:graphicFrame>`,
    )}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`,
  );

  const layoutRel = (n: number) => rels([{ id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" }, ...(n === 7 ? [{ id: "rId2", type: "image", target: "../media/image1.png" }] : [])]);
  const parts: Parts = {
    "ppt/presentation.xml": presentationXml({ cx: 9144000, cy: 5143500, masters: 1, slides: 3 }),
    "ppt/_rels/presentation.xml.rels": presentationRels(1, 3),
    "ppt/theme/theme1.xml": theme,
    "ppt/slideMasters/slideMaster1.xml": master,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": rels([
      ...[1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: `rId${i}`, type: "slideLayout", target: `../slideLayouts/slideLayout${i}.xml` })),
      { id: "rId8", type: "theme", target: "../theme/theme1.xml" },
    ]),
    "ppt/slides/slide1.xml": slide1,
    "ppt/slides/_rels/slide1.xml.rels": rels([{ id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" }, { id: "rId2", type: "notesSlide", target: "../notesSlides/notesSlide1.xml" }]),
    "ppt/slides/slide2.xml": slide2,
    "ppt/slides/_rels/slide2.xml.rels": rels([
      { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout3.xml" },
      { id: "rId2", type: "notesSlide", target: "../notesSlides/notesSlide2.xml" },
      { id: "rId3", type: "hyperlink", target: "https://example.com/community", external: true },
    ]),
    "ppt/slides/slide3.xml": slide3,
    "ppt/slides/_rels/slide3.xml.rels": rels([{ id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout7.xml" }]),
    "ppt/notesSlides/notesSlide1.xml": notesSlide(["Welcome everyone."]),
    "ppt/notesSlides/_rels/notesSlide1.xml.rels": rels([{ id: "rId1", type: "slide", target: "../slides/slide1.xml" }]),
    "ppt/notesSlides/notesSlide2.xml": notesSlide(["First goal.", "", "Second goal."]),
    "ppt/notesSlides/_rels/notesSlide2.xml.rels": rels([{ id: "rId1", type: "slide", target: "../slides/slide2.xml" }]),
    "ppt/media/image1.png": PNG_1X1,
  };
  Object.entries(layouts).forEach(([name, body], i) => {
    parts[`ppt/slideLayouts/${name}`] = body;
    parts[`ppt/slideLayouts/_rels/${name}.rels`] = layoutRel(i + 1);
  });
  return pptx(parts);
}

// ---- 3. A 4:3 deck -------------------------------------------------------------------------------------------------

export interface SimpleDeckOptions {
  cx?: number;
  cy?: number;
  /** Relationships to add to each slide (besides its layout). */
  slideRels?: RelSpec[][];
  /** Extra parts, or replacements (a `null` removes). */
  parts?: Record<string, string | Uint8Array>;
  /** Attributes for the `p:sld` root. */
  slideAttrs?: string;
  /** Markup after the colour map override (transitions…). */
  slideTail?: string;
}

/** A small deck on a Classic master: every slide is "Title and Content" (layout 2) and holds the given shape XML. */
export function simpleDeck(slideShapes: string[], options: SimpleDeckOptions = {}): Uint8Array {
  return buildClassic(slideShapes, options);
}

/** A small 4:3 presentation (10 by 7.5 inches) with one master, two layouts and two slides. */
export function classic43(): Uint8Array {
  return buildClassic(
    [
      sp(2, "Title 1", { ph: '<p:ph type="ctrTitle"/>', spPr: "", tx: txBody(para("Safety briefing")) }) + sp(3, "Subtitle 2", { ph: '<p:ph type="subTitle" idx="1"/>', spPr: "", tx: txBody(para("Example Corp")) }),
      sp(2, "Title 1", { ph: '<p:ph type="title"/>', spPr: "", tx: txBody(para("Rules")) }) + sp(3, "Content Placeholder 2", { ph: '<p:ph idx="1"/>', spPr: "", tx: txBody(para("Wear a helmet") + para("Report hazards")) }),
    ],
    {},
    [1, 2],
  );
}

/** Rewrites a package: `edit` gets every part (as text where it is text) and may change, add or delete (`delete parts[name]`) them. */
export function editPptx(bytes: Uint8Array, edit: (parts: Parts) => void): Uint8Array {
  const raw = unzipSync(bytes);
  const parts: Parts = {};
  for (const [name, data] of Object.entries(raw)) parts[name] = /\.(xml|rels)$/.test(name) ? strFromU8(data) : data;
  edit(parts);
  return pptx(parts);
}

function buildClassic(slideShapes: string[], options: SimpleDeckOptions, layouts: number[] = []): Uint8Array {
  const theme = themeXml({ name: "Classic", sys: true, major: "Arial", minor: "Arial", colors: ["000000", "FFFFFF", "1F497D", "EEECE1", "4F81BD", "C0504D", "9BBB59", "8064A2", "4BACC6", "F79646", "0000FF", "800080"] });
  const master = root(
    "p:sldMaster",
    "",
    `<p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>${tree(
      sp(2, "Title Placeholder 1", { ph: '<p:ph type="title"/>', spPr: `${xfrm(457200, 274638, 8229600, 1143000)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`, tx: txBody(`<a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master title style</a:t></a:r></a:p>`, '<a:bodyPr anchor="ctr"/>') }) +
        sp(3, "Text Placeholder 2", { ph: '<p:ph type="body" idx="1"/>', spPr: `${xfrm(457200, 1600200, 8229600, 4525963)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`, tx: txBody(`<a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p>`) }),
    )}</p:cSld>${STD_MAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4400" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900" algn="l"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="3200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle/></p:txStyles>`,
  );
  const layoutXml = (type: string, name: string, inner: string) => root("p:sldLayout", `type="${type}"`, `<p:cSld name="${name}">${tree(inner)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`);
  const layout1 = layoutXml("title", "Title Slide", sp(2, "Title 1", { ph: '<p:ph type="ctrTitle"/>', spPr: xfrm(685800, 2130425, 7772400, 1470025), tx: txBody(`<a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master title style</a:t></a:r></a:p>`) }) + sp(3, "Subtitle 2", { ph: '<p:ph type="subTitle" idx="1"/>', spPr: xfrm(1371600, 3886200, 6400800, 1752600), tx: txBody(`<a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master subtitle style</a:t></a:r></a:p>`, "<a:bodyPr/>", `<a:lstStyle><a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="2400"/></a:lvl1pPr></a:lstStyle>`) }));
  const layout2 = layoutXml("obj", "Title and Content", sp(2, "Title 1", { ph: '<p:ph type="title"/>', spPr: "", tx: txBody(`<a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master title style</a:t></a:r></a:p>`) }) + sp(3, "Content Placeholder 2", { ph: '<p:ph idx="1"/>', spPr: "", tx: txBody(`<a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p>`) }));
  const slide = (inner: string) => root("p:sld", options.slideAttrs ?? "", `${spTree(inner)}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${options.slideTail ?? ""}`);
  const parts: Parts = {
    "ppt/presentation.xml": presentationXml({ cx: options.cx ?? 9144000, cy: options.cy ?? 6858000, masters: 1, slides: slideShapes.length }),
    "ppt/_rels/presentation.xml.rels": presentationRels(1, slideShapes.length),
    "ppt/theme/theme1.xml": theme,
    "ppt/slideMasters/slideMaster1.xml": master,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": rels([
      { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
      { id: "rId2", type: "slideLayout", target: "../slideLayouts/slideLayout2.xml" },
      { id: "rId3", type: "theme", target: "../theme/theme1.xml" },
    ]),
    "ppt/slideLayouts/slideLayout1.xml": layout1,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels([{ id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" }]),
    "ppt/slideLayouts/slideLayout2.xml": layout2,
    "ppt/slideLayouts/_rels/slideLayout2.xml.rels": rels([{ id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" }]),
  };
  slideShapes.forEach((shapes, i) => {
    parts[`ppt/slides/slide${i + 1}.xml`] = slide(shapes);
    parts[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels([{ id: "rId1", type: "slideLayout", target: `../slideLayouts/slideLayout${layouts[i] ?? 2}.xml` }, ...(options.slideRels?.[i] ?? [])]);
  });
  for (const [name, data] of Object.entries(options.parts ?? {})) {
    if ((data as unknown) === null) delete parts[name];
    else parts[name] = data;
  }
  return pptx(parts);
}

// ---- Charts --------------------------------------------------------------------------------------------------------

export const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";

/** A `p:graphicFrame` that holds the chart of relationship `rid`. */
export function chartFrame(id: number, name: string, rid: string, box: [number, number, number, number] = [914400, 914400, 4572000, 2743200]): string {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${box[0]}" y="${box[1]}"/><a:ext cx="${box[2]}" cy="${box[3]}"/></p:xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
}

/** `c:strRef` with a cache. */
export const cStrRef = (f: string, items: string[]): string =>
  `<c:strRef><c:f>${f}</c:f><c:strCache><c:ptCount val="${items.length}"/>${items.map((t, i) => `<c:pt idx="${i}"><c:v>${t}</c:v></c:pt>`).join("")}</c:strCache></c:strRef>`;

/** `c:numRef` with a cache (a `null` is a blank cell). */
export const cNumRef = (f: string, items: (number | null)[], fmt = "General"): string =>
  `<c:numRef><c:f>${f}</c:f><c:numCache><c:formatCode>${fmt}</c:formatCode><c:ptCount val="${items.length}"/>${items.map((v, i) => (v === null ? "" : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join("")}</c:numCache></c:numRef>`;

export interface CSer {
  idx: number;
  name: string;
  /** Inside `c:spPr` (fill or line). */
  spPr?: string;
  cats?: string[];
  vals: (number | null)[];
  /** Extra children before `c:cat` (`c:invertIfNegative`, `c:marker`, `c:dPt`, `c:dLbls`). */
  head?: string;
  /** After `c:val` (`c:smooth`). */
  tail?: string;
}

/** A bar, line, area or pie series, with the children in schema order. */
export function cSer(s: CSer): string {
  const col = String.fromCharCode(66 + s.idx);
  const cats = s.cats ?? ["A", "B", "C"];
  return `<c:ser><c:idx val="${s.idx}"/><c:order val="${s.idx}"/><c:tx>${cStrRef(`Sheet1!$${col}$1`, [s.name])}</c:tx>${s.spPr ? `<c:spPr>${s.spPr}</c:spPr>` : ""}${s.head ?? ""}<c:cat>${cStrRef(`Sheet1!$A$2:$A$${cats.length + 1}`, cats)}</c:cat><c:val>${cNumRef(`Sheet1!$${col}$2:$${col}$${s.vals.length + 1}`, s.vals)}</c:val>${s.tail ?? ""}</c:ser>`;
}

export const solid = (scheme: string, mods = ""): string => `<a:solidFill><a:schemeClr val="${scheme}">${mods}</a:schemeClr></a:solidFill>`;
export const srgb = (hex: string): string => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;

export interface ChartDoc {
  /** The chart-type elements (`c:barChart`...) and axes, inside `c:plotArea` after `c:layout`. */
  plot: string;
  title?: string;
  autoTitleDeleted?: boolean;
  legend?: string;
  /** Children of `c:chartSpace` after `c:chart`. */
  tail?: string;
}

/** A `c:chartSpace` document. */
export function chartDoc(d: ChartDoc): string {
  return xml(
    `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:date1904 val="0"/><c:roundedCorners val="0"/><c:chart>${d.title ?? ""}<c:autoTitleDeleted val="${d.autoTitleDeleted === false ? 0 : 1}"/><c:plotArea><c:layout/>${d.plot}</c:plotArea>${d.legend ?? ""}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>${d.tail ?? ""}</c:chartSpace>`,
  );
}

/** The standard pair of axes of a bar or line chart. */
export function cAxes(opts: { catDelete?: boolean; valDelete?: boolean; grid?: boolean; valFmt?: string; min?: number; max?: number; pos?: [string, string] } = {}): string {
  const [catPos, valPos] = opts.pos ?? ["b", "l"];
  return (
    `<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${opts.catDelete ? 1 : 0}"/><c:axPos val="${catPos}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/>${opts.max !== undefined ? `<c:max val="${opts.max}"/>` : ""}${opts.min !== undefined ? `<c:min val="${opts.min}"/>` : ""}</c:scaling><c:delete val="${opts.valDelete ? 1 : 0}"/><c:axPos val="${valPos}"/>${opts.grid === false ? "" : "<c:majorGridlines/>"}<c:numFmt formatCode="${opts.valFmt ?? "General"}" sourceLinked="${opts.valFmt ? 0 : 1}"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`
  );
}

/** A deck with one chart per slide: `charts[i]` is the chart part's XML and the slide gets a frame for it. */
export function deckWithCharts(charts: string[], frame: (i: number) => string = (i) => chartFrame(10 + i, `Chart ${i + 1}`, "rId5")): Uint8Array {
  const parts: Record<string, string | Uint8Array> = {};
  charts.forEach((c, i) => {
    parts[`ppt/charts/chart${i + 1}.xml`] = c;
  });
  return simpleDeck(charts.map((_, i) => frame(i)), {
    slideRels: charts.map((_, i) => [{ id: "rId5", type: "chart", target: `../charts/chart${i + 1}.xml` }]),
    parts,
  });
}
