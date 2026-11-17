import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { parseXml, type XmlElement } from "@pli.dev/core";
import { describe, expect, it } from "vitest";
import { DeckSession, LIGHT_THEME, SIZE_WIDESCREEN, buildMaster, createDeck, paragraphsFromText, type Deck, type Master } from "../src";
import { PRESET_GEOMETRIES } from "../src/presets";
import { OpcPackage, Part, relativeTarget } from "../src/pptx/opc";
import { PRESET_ALIASES, PRESET_NAMES, toPotx, toPptx } from "../src/pptx/write";

// A 5x5 red dot, a 1x1 GIF and a small SVG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==";
const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const SVG = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>')}`;
const DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 6));

// ---- A deck that uses every feature ------------------------------------------------------------------------------

function fullDeck(): Deck {
  const s = new DeckSession(createDeck({ title: "Quarterly <review> & plan", size: SIZE_WIDESCREEN }));
  const first = s.deck.slides[0]!;
  const title = first.elements[0]!;
  s.setText(first.id, title.id, paragraphsFromText("Hello, \"world\""));
  s.setNotes(first.id, "First line of notes\nSecond line");
  s.setTransition([first.id], { type: "fade", duration: 500, advanceAfter: 4000 });

  const body = s.addSlide();
  const bodyPh = body.elements[1]!;
  s.setText(body.id, bodyPh.id, [
    { runs: [{ text: "Plain " }, { text: "bold", marks: { bold: true, color: { theme: "accent1", lumMod: 0.6, lumOff: 0.4 } } }, { text: " link", marks: { link: "example.com/a b?x=1&y=2", underline: true } }], bullet: { type: "char", char: "*", color: "#ff0000", size: 80, font: "Arial" }, spaceBefore: 6, spaceAfter: 3, lineSpacing: 1.5, marL: 36, indent: -18 },
    { runs: [{ text: "H" }, { text: "2", marks: { baseline: "sub" } }, { text: "O and x" }, { text: "2", marks: { baseline: "super", highlight: "#ffff00", strike: true, italic: true, fontSize: 12.5, fontFamily: "+mj-lt", letterSpacing: 1.5, allCaps: true } }], level: 1, bullet: { type: "number", scheme: "alphaLcPeriod", start: 3 } },
    { runs: [{ text: "7", marks: { field: "slideNumber" } }, { text: " two\nlines", marks: { smallCaps: true } }], align: "justify", rtl: true, bullet: null },
    { runs: [] },
  ]);
  s.setTransition([body.id], { type: "push", direction: "left", duration: 900 });
  s.setBackground([body.id], { gradient: { angle: 45, stops: [{ at: 1, color: "#112233" }, { at: 0, color: { theme: "lt2", tint: 0.5, alpha: 0.5 } }] } });

  const shapes = s.addSlide({ layout: s.deck.masters[0]!.layouts.find((l) => l.kind === "titleOnly")!.id });
  s.setSkipped([shapes.id], true);
  s.setNotes(shapes.id, "Notes with <markup> & more");
  const rect = s.addShape(shapes.id, "rect", { x: 20, y: 120, w: 200, h: 100 }, {
    name: "Box",
    alt: "A decorative box",
    link: "https://example.com/",
    rotation: 30,
    flipH: true,
    adjust: { adj: 12500.4 },
    fill: { gradient: { kind: "linear", angle: 90, stops: [{ at: 0, color: { theme: "dk1" } }, { at: 1, color: { theme: "lt1", shade: 0.25 } }] } },
    line: { width: 2.5, color: { theme: "accent2" }, dash: "longDashDot", cap: "round", join: "bevel", head: "triangle", tail: "open" },
    shadow: { color: "#000000", blur: 6, dx: 3, dy: 4 },
    text: { paragraphs: paragraphsFromText("Inside"), vAlign: "middle", insets: { l: 4, t: 2, r: 6, b: 8 }, autofit: "shrink", wrap: false, levels: { 0: { align: "center", marks: { fontSize: 20 } }, 2: { marL: 10 } } },
  });
  s.addShape(shapes.id, "roundRect", { x: 240, y: 120, w: 100, h: 100 }, { fill: null, line: null, hidden: true, adjust: { adj: 30000 } });
  s.addShape(shapes.id, "notAShape", { x: 240, y: 240, w: 60, h: 60 });
  s.addShape(shapes.id, "ellipse", { x: 360, y: 120, w: 100, h: 100 }, { fill: { image: { src: PNG, mode: "tile", alpha: 0.5, crop: { l: 0.1 } } } });
  s.addShape(shapes.id, "radial", { x: 360, y: 240, w: 10, h: 10 }, { fill: { gradient: { kind: "radial", stops: [{ at: 0.5, color: "#00ff00" }] } } });
  s.addShape(shapes.id, "line", { x: 20, y: 300, w: 200, h: 0 }, { line: { width: 3, color: "#336699", tail: "stealth", head: "oval" } });
  s.addShape(shapes.id, "bentConnector3", { x: 20, y: 320, w: 100, h: 40 });
  s.addTextBox(shapes.id, { x: 500, y: 120, w: 200, h: 40 }, "Text box");
  s.addImage(shapes.id, PNG, { w: 5, h: 5 }, { x: 500, y: 200 }, { alt: "Dot <1>", crop: { l: 0.1, t: 0.2, r: 0.05, b: 0 }, geometry: "ellipse", line: { width: 1, color: "#000000" }, link: "mailto:a@example.org" });
  s.addImage(shapes.id, PNG, { w: 5, h: 5 }, { x: 560, y: 200 });
  s.addImage(shapes.id, GIF, { w: 1, h: 1 }, { x: 600, y: 200 });
  s.addImage(shapes.id, SVG, { w: 10, h: 10 }, { x: 620, y: 200 });
  s.addImage(shapes.id, "https://example.com/pic.png", { w: 10, h: 10 }, { x: 640, y: 200 });
  s.addImage(shapes.id, "blob:nothing", { w: 10, h: 10 }, { x: 640, y: 200 });

  const a = s.addShape(shapes.id, "rect", { x: 20, y: 400, w: 40, h: 40 });
  const b = s.addShape(shapes.id, "ellipse", { x: 100, y: 410, w: 40, h: 40 }, { text: { paragraphs: paragraphsFromText("in group") } });
  const gid = s.group(shapes.id, [a.id, b.id])!;
  void gid;

  const tables = s.addSlide();
  const table = s.addTable(tables.id, 4, 3, { x: 40, y: 140, w: 600 });
  s.setCellParagraphs(tables.id, table.id, 0, 0, paragraphsFromText("Header"));
  s.setCellParagraphs(tables.id, table.id, 1, 1, paragraphsFromText("Cell"));
  s.setTableOptions(tables.id, table.id, { headerRow: true, banded: true });
  s.mergeCells(tables.id, table.id, { r1: 1, c1: 0, r2: 2, c2: 1 });
  s.mergeCells(tables.id, table.id, { r1: 3, c1: 1, r2: 3, c2: 2 });
  s.setTableCells(tables.id, table.id, [[1, 2]], { fill: { theme: "accent3" }, vAlign: "bottom", borders: { top: null, left: { width: 3, color: "#ff0000", dash: "dash" } } });

  // a second master with its own theme, and a slide on it
  const second: Master = buildMaster({ name: "Dark", theme: { ...LIGHT_THEME, name: "Dark <1>", colors: { ...LIGHT_THEME.colors, dk1: "#ffffff", lt1: "#101010" }, fonts: { major: "Georgia", minor: "Verdana" } }, size: SIZE_WIDESCREEN, background: { theme: "lt1" }, decorations: (size) => [{ type: "shape", id: "deco", geometry: "rect", x: 0, y: 0, w: size.width, h: 6, fill: { theme: "accent1" } }] });
  const deck = s.deck;
  deck.masters.push(second);
  deck.slides[deck.slides.length - 1]!.layout = second.layouts[1]!.id;
  deck.masters[0]!.layouts[2]!.showMasterElements = false;
  deck.masters[0]!.layouts[2]!.background = "#fafafa";
  void rect;
  return deck;
}

// ---- Reading the package back ------------------------------------------------------------------------------------

type Files = Record<string, Uint8Array>;
const unzip = (bytes: Uint8Array): Files => unzipSync(bytes);
const text = (files: Files, name: string): string => strFromU8(files[name]!);
const xmlNames = (files: Files): string[] => Object.keys(files).filter((n) => /\.(xml|rels)$/.test(n));

function walk(el: XmlElement, visit: (e: XmlElement, path: string[]) => void, path: string[] = []): void {
  visit(el, path);
  for (const c of el.children) if (typeof c !== "string") walk(c, visit, [...path, el.name]);
}

const attrOf = (e: XmlElement, name: string): string | undefined => e.attrs[name] ?? Object.entries(e.attrs).find(([k]) => k.endsWith(`:${name}`))?.[1];

/** Child order of the elements this writer emits: each name lists its children in schema order (a name may stand for several alternatives of one choice). */
const FILL = ["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"];
const RUN_PROPS = ["ln", ...FILL, "effectLst", "effectDag", "highlight", "uLnTx", "uLn", "uFillTx", "uFill", "latin", "ea", "cs", "sym", "hlinkClick", "hlinkMouseOver", "rtl", "extLst"];
const PARA_PROPS = ["lnSpc", "spcBef", "spcAft", ["buClrTx", "buClr"], ["buSzTx", "buSzPct", "buSzPts"], ["buFontTx", "buFont"], ["buNone", "buAutoNum", "buChar", "buBlip"], "tabLst", "defRPr", "extLst"];
type Rank = string | string[];
const ORDER: Record<string, Rank[]> = {
  sp: ["nvSpPr", "spPr", "style", "txBody"],
  cxnSp: ["nvCxnSpPr", "spPr", "style"],
  pic: ["nvPicPr", "blipFill", "spPr", "style"],
  graphicFrame: ["nvGraphicFramePr", "xfrm", "graphic"],
  grpSp: ["nvGrpSpPr", "grpSpPr", ["sp", "grpSp", "graphicFrame", "cxnSp", "pic"]],
  nvSpPr: ["cNvPr", "cNvSpPr", "nvPr"],
  nvPicPr: ["cNvPr", "cNvPicPr", "nvPr"],
  nvCxnSpPr: ["cNvPr", "cNvCxnSpPr", "nvPr"],
  nvGrpSpPr: ["cNvPr", "cNvGrpSpPr", "nvPr"],
  nvGraphicFramePr: ["cNvPr", "cNvGraphicFramePr", "nvPr"],
  cNvPr: ["hlinkClick", "hlinkHover", "extLst"],
  spPr: ["xfrm", ["custGeom", "prstGeom"], FILL, "ln", ["effectLst", "effectDag"], "scene3d", "sp3d", "extLst"],
  grpSpPr: ["xfrm", FILL, ["effectLst", "effectDag"], "scene3d", "extLst"],
  xfrm: ["off", "ext", "chOff", "chExt"],
  prstGeom: ["avLst"],
  ln: [FILL, ["prstDash", "custDash"], ["round", "bevel", "miter"], "headEnd", "tailEnd", "extLst"],
  lnL: [FILL, ["prstDash", "custDash"], ["round", "bevel", "miter"], "headEnd", "tailEnd", "extLst"],
  lnR: [FILL, ["prstDash", "custDash"], ["round", "bevel", "miter"], "headEnd", "tailEnd", "extLst"],
  lnT: [FILL, ["prstDash", "custDash"], ["round", "bevel", "miter"], "headEnd", "tailEnd", "extLst"],
  lnB: [FILL, ["prstDash", "custDash"], ["round", "bevel", "miter"], "headEnd", "tailEnd", "extLst"],
  txBody: ["bodyPr", "lstStyle", "p"],
  bodyPr: ["prstTxWarp", ["noAutofit", "normAutofit", "spAutoFit"], "scene3d", "sp3d", "flatTx", "extLst"],
  lstStyle: ["defPPr", "lvl1pPr", "lvl2pPr", "lvl3pPr", "lvl4pPr", "lvl5pPr", "lvl6pPr", "lvl7pPr", "lvl8pPr", "lvl9pPr", "extLst"],
  titleStyle: ["defPPr", "lvl1pPr", "lvl2pPr", "lvl3pPr", "lvl4pPr", "lvl5pPr", "lvl6pPr", "lvl7pPr", "lvl8pPr", "lvl9pPr", "extLst"],
  bodyStyle: ["defPPr", "lvl1pPr", "lvl2pPr", "lvl3pPr", "lvl4pPr", "lvl5pPr", "lvl6pPr", "lvl7pPr", "lvl8pPr", "lvl9pPr", "extLst"],
  otherStyle: ["defPPr", "lvl1pPr", "lvl2pPr", "lvl3pPr", "lvl4pPr", "lvl5pPr", "lvl6pPr", "lvl7pPr", "lvl8pPr", "lvl9pPr", "extLst"],
  defaultTextStyle: ["defPPr", "lvl1pPr", "lvl2pPr", "lvl3pPr", "lvl4pPr", "lvl5pPr", "lvl6pPr", "lvl7pPr", "lvl8pPr", "lvl9pPr", "extLst"],
  notesStyle: ["defPPr", "lvl1pPr", "lvl2pPr", "lvl3pPr", "lvl4pPr", "lvl5pPr", "lvl6pPr", "lvl7pPr", "lvl8pPr", "lvl9pPr", "extLst"],
  pPr: PARA_PROPS,
  defPPr: PARA_PROPS,
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`lvl${n}pPr`, PARA_PROPS])),
  rPr: RUN_PROPS,
  defRPr: RUN_PROPS,
  endParaRPr: RUN_PROPS,
  p: ["pPr", ["r", "br", "fld"], "endParaRPr"],
  r: ["rPr", "t"],
  br: ["rPr"],
  fld: ["rPr", "pPr", "t"],
  tbl: ["tblPr", "tblGrid", "tr"],
  tc: ["txBody", "tcPr"],
  tcPr: ["lnL", "lnR", "lnT", "lnB", "lnTlToBr", "lnBlToTr", "cell3D", FILL, "headers", "extLst"],
  blipFill: ["blip", "srcRect", ["tile", "stretch"]],
  gradFill: ["gsLst", ["lin", "path"], "tileRect"],
  blip: [["alphaModFix"], "extLst"],
  sld: ["cSld", "clrMapOvr", ["transition", "AlternateContent"], "timing", "extLst"],
  sldLayout: ["cSld", "clrMapOvr", "transition", "timing", "hf", "extLst"],
  sldMaster: ["cSld", "clrMap", "sldLayoutIdLst", "transition", "timing", "hf", "txStyles", "extLst"],
  notesMaster: ["cSld", "clrMap", "hf", "notesStyle", "extLst"],
  notes: ["cSld", "clrMapOvr", "extLst"],
  cSld: ["bg", "spTree", "custDataLst", "controls", "extLst"],
  spTree: ["nvGrpSpPr", "grpSpPr", ["sp", "grpSp", "graphicFrame", "cxnSp", "pic"]],
  bgPr: [FILL, ["effectLst", "effectDag"], "extLst"],
  presentation: ["sldMasterIdLst", "notesMasterIdLst", "handoutMasterIdLst", "sldIdLst", "sldSz", "notesSz", "smartTags", "embeddedFontLst", "custShowLst", "photoAlbum", "custDataLst", "kinsoku", "defaultTextStyle", "modifyVerifier", "extLst"],
  txStyles: ["titleStyle", "bodyStyle", "otherStyle", "extLst"],
  theme: ["themeElements", "objectDefaults", "extraClrSchemeLst", "custClrLst", "extLst"],
  themeElements: ["clrScheme", "fontScheme", "fmtScheme", "extLst"],
  clrScheme: ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"],
  fontScheme: ["majorFont", "minorFont"],
  majorFont: ["latin", "ea", "cs", "font"],
  minorFont: ["latin", "ea", "cs", "font"],
  fmtScheme: ["fillStyleLst", "lnStyleLst", "effectStyleLst", "bgFillStyleLst"],
  transition: [["fade", "dissolve", "cover", "push", "wipe", "zoom"], "sndAc"],
};

function rankOf(rule: Rank[], name: string): number {
  return rule.findIndex((r) => (Array.isArray(r) ? r.includes(name) : r === name));
}

function checkOrder(root: XmlElement, part: string): string[] {
  const problems: string[] = [];
  walk(root, (e) => {
    const rule = ORDER[e.name];
    if (!rule) return;
    let last = -1;
    for (const c of e.children) {
      if (typeof c === "string") continue;
      const r = rankOf(rule, c.name);
      if (r < 0) problems.push(`${part}: <${e.name}> may not contain <${c.name}>`);
      else if (r < last) problems.push(`${part}: <${c.name}> is out of order in <${e.name}>`);
      else last = r;
    }
  });
  return problems;
}

const contentTypes = (files: Files) => {
  const root = parseXml(text(files, "[Content_Types].xml"));
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const c of root.children) {
    if (typeof c === "string") continue;
    if (c.name === "Default") defaults.set(c.attrs.Extension!.toLowerCase(), c.attrs.ContentType!);
    else overrides.set(c.attrs.PartName!, c.attrs.ContentType!);
  }
  return { defaults, overrides };
};

const resolveTarget = (source: string, target: string): string => {
  const base = source.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") base.pop();
    else if (seg !== ".") base.push(seg);
  }
  return base.join("/");
};

/** Counts the entries of the zip's central directory, so a duplicate name can't hide in an object. */
function zipEntryNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names: string[] = [];
  for (let i = 0; i + 46 < bytes.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const n = view.getUint16(i + 28, true);
    names.push(strFromU8(bytes.subarray(i + 46, i + 46 + n)));
    i += 45 + n;
  }
  return names;
}

const slideParts = (files: Files) => Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));

// ---- Tests -------------------------------------------------------------------------------------------------------

describe("PPTX export: package structure", () => {
  const deck = fullDeck();
  const bytes = toPptx(deck, { date: DATE });
  const files = unzip(bytes);

  it("is a zip with [Content_Types].xml first, no duplicate names, and every XML part well formed", () => {
    const names = zipEntryNames(bytes);
    expect(names[0]).toBe("[Content_Types].xml");
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(names.sort()).toEqual(Object.keys(files).sort());
    for (const name of xmlNames(files)) expect(() => parseXml(text(files, name)), name).not.toThrow();
    for (const name of xmlNames(files)) expect(text(files, name).startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), name).toBe(true);
  });

  it("gives every part a content type, and declares nothing that isn't there", () => {
    const { defaults, overrides } = contentTypes(files);
    for (const name of Object.keys(files)) {
      if (name === "[Content_Types].xml") continue;
      const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
      expect(overrides.get(`/${name}`) ?? defaults.get(ext), name).toBeTruthy();
    }
    for (const part of overrides.keys()) expect(files[part.slice(1)], part).toBeDefined();
    expect(overrides.get("/ppt/presentation.xml")).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml");
    expect(overrides.get("/ppt/slides/slide1.xml")).toBe("application/vnd.openxmlformats-officedocument.presentationml.slide+xml");
    expect(defaults.get("png")).toBe("image/png");
    expect(defaults.get("gif")).toBe("image/gif");
    expect(defaults.get("svg")).toBe("image/svg+xml");
    expect(defaults.get("rels")).toBe("application/vnd.openxmlformats-package.relationships+xml");
  });

  it("has relationships that all point at parts of the package, with unique ids", () => {
    const rels = Object.keys(files).filter((n) => n.endsWith(".rels"));
    expect(rels).toContain("_rels/.rels");
    for (const rel of rels) {
      const source = rel === "_rels/.rels" ? "" : rel.replace("_rels/", "").replace(/\.rels$/, "");
      if (source) expect(files[source], `${rel} belongs to a missing part`).toBeDefined();
      const ids = new Set<string>();
      for (const r of parseXml(text(files, rel)).children) {
        if (typeof r === "string") continue;
        expect(ids.has(r.attrs.Id!), `${rel} repeats ${r.attrs.Id}`).toBe(false);
        ids.add(r.attrs.Id!);
        if (r.attrs.TargetMode === "External") continue;
        expect(files[resolveTarget(source, r.attrs.Target!)], `${rel} -> ${r.attrs.Target}`).toBeDefined();
      }
    }
  });

  it("uses every r:id and r:embed of a part from that part's relationships", () => {
    for (const name of xmlNames(files).filter((n) => !n.endsWith(".rels") && n.startsWith("ppt/"))) {
      const relName = name.replace(/([^/]+)$/, "_rels/$1.rels");
      const ids = new Set<string>();
      if (files[relName]) for (const r of parseXml(text(files, relName)).children) if (typeof r !== "string") ids.add(r.attrs.Id!);
      walk(parseXml(text(files, name)), (e) => {
        for (const [k, v] of Object.entries(e.attrs)) if (/^r:(id|embed|link)$/.test(k)) expect(ids.has(v), `${name}: ${k}="${v}"`).toBe(true);
      });
    }
  });

  it("writes the document properties", () => {
    const core = parseXml(text(files, "docProps/core.xml"));
    expect(JSON.stringify(core)).toContain("Quarterly <review> & plan");
    expect(text(files, "docProps/core.xml")).toContain("<dcterms:created xsi:type=\"dcterms:W3CDTF\">2026-01-02T03:04:06Z</dcterms:created>");
    const app = text(files, "docProps/app.xml");
    expect(app).toContain("<Slides>4</Slides>");
    expect(app).toContain("<Notes>2</Notes>");
    expect(app).toContain("<HiddenSlides>1</HiddenSlides>");
  });

  it("numbers slide masters and layouts from 2147483648 and slides from 256, all unique", () => {
    const pres = parseXml(text(files, "ppt/presentation.xml"));
    const ids = (parent: string, child: string) => {
      const list: number[] = [];
      walk(pres, (e) => {
        if (e.name === child) list.push(Number(attrOf(e, "id")));
      });
      void parent;
      return list;
    };
    const masterIds = ids("sldMasterIdLst", "sldMasterId");
    const slideIds = ids("sldIdLst", "sldId");
    expect(masterIds).toEqual([2147483648, 2147483649]);
    expect(slideIds).toEqual([256, 257, 258, 259]);
    const layoutIds: number[] = [];
    for (const n of Object.keys(files).filter((x) => /slideMaster\d+\.xml$/.test(x))) {
      walk(parseXml(text(files, n)), (e) => {
        if (e.name === "sldLayoutId") layoutIds.push(Number(attrOf(e, "id")));
      });
    }
    const all = [...masterIds, ...layoutIds];
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) {
      expect(id).toBeGreaterThanOrEqual(2147483648);
      expect(id).toBeLessThan(2 ** 32);
    }
    expect(layoutIds.length).toBe(deck.masters.reduce((n, m) => n + m.layouts.length, 0));
    expect(Object.keys(files).filter((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n)).length).toBe(deck.masters.length + 1);
  });

  it("converts the slide size to EMU", () => {
    const root = parseXml(text(files, "ppt/presentation.xml"));
    let size: XmlElement | undefined;
    walk(root, (e) => {
      if (e.name === "sldSz") size = e;
    });
    expect(size!.attrs).toEqual({ cx: String(960 * 12700), cy: String(540 * 12700) });
    const four3 = unzip(toPptx(createDeck({ size: { width: 720, height: 540 } }), { date: DATE }));
    expect(text(four3, "ppt/presentation.xml")).toContain('<p:sldSz cx="9144000" cy="6858000"/>');
  });

  it("is byte for byte the same for the same deck and date, and differs for another date", () => {
    expect(toPptx(deck, { date: DATE })).toEqual(bytes);
    expect(toPptx(fullDeck(), { date: DATE }).length).toBeGreaterThan(0);
    expect(toPptx(deck, { date: new Date(DATE.getTime() + 86_400_000) })).not.toEqual(bytes);
    expect(toPotx(deck, { date: DATE })).toEqual(toPotx(deck, { date: DATE }));
  });

  it("is also accepted by xmllint as well formed", () => {
    if (!existsSync("/usr/bin/xmllint")) return;
    const dir = mkdtempSync(join(tmpdir(), "pptx-lint-"));
    try {
      const lint = (name: string, data: Uint8Array) => {
        const file = join(dir, name.replace(/[/\\[\]]/g, "_"));
        writeFileSync(file, data);
        execFileSync("/usr/bin/xmllint", ["--noout", file], { stdio: "pipe" });
      };
      for (const name of xmlNames(files)) lint(name, files[name]!);
      lint("potx_ct.xml", unzip(toPotx(deck, { date: DATE }))["[Content_Types].xml"]!);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("PPTX export: schema order and ids", () => {
  const deck = fullDeck();
  const files = unzip(toPptx(deck, { date: DATE }));

  it("keeps the child order of ECMA-376 in every part", () => {
    const problems: string[] = [];
    for (const name of xmlNames(files).filter((n) => !n.endsWith(".rels"))) problems.push(...checkOrder(parseXml(text(files, name)), name));
    expect(problems).toEqual([]);
  });

  it("the order checker notices a misplaced element", () => {
    expect(checkOrder(parseXml("<spPr><ln/><xfrm/></spPr>"), "x")).toEqual(["x: <xfrm> is out of order in <spPr>"]);
    expect(checkOrder(parseXml("<pPr><defRPr/><lnSpc/></pPr>"), "x").length).toBe(1);
    expect(checkOrder(parseXml("<tcPr><solidFill/><lnL/></tcPr>"), "x").length).toBe(1);
  });

  it("gives every shape of a part a unique id", () => {
    for (const name of Object.keys(files).filter((n) => /^ppt\/(slides|slideLayouts|slideMasters|notesSlides|notesMasters)\/[^/]+\.xml$/.test(n))) {
      const ids: string[] = [];
      walk(parseXml(text(files, name)), (e) => {
        if (e.name === "cNvPr") ids.push(e.attrs.id!);
      });
      expect(new Set(ids).size, name).toBe(ids.length);
      expect(ids[0], name).toBe("1");
      for (const id of ids) expect(Number(id)).toBeGreaterThan(0);
    }
  });

  it("gives placeholders of a part distinct type and idx pairs", () => {
    for (const name of Object.keys(files).filter((n) => /^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(n))) {
      const keys: string[] = [];
      walk(parseXml(text(files, name)), (e) => {
        if (e.name === "ph") keys.push(`${e.attrs.type}:${e.attrs.idx ?? 0}`);
      });
      expect(new Set(keys).size, `${name}: ${keys.join(",")}`).toBe(keys.length);
    }
  });

  it("writes only integers where the schema wants integers, and nothing negative for sizes", () => {
    for (const name of slideParts(files)) {
      walk(parseXml(text(files, name)), (e) => {
        if (e.name === "ext" && e.attrs.cx !== undefined) {
          expect(e.attrs.cx).toMatch(/^\d+$/);
          expect(e.attrs.cy).toMatch(/^\d+$/);
        }
        if (e.name === "off") {
          expect(e.attrs.x).toMatch(/^-?\d+$/);
          expect(e.attrs.y).toMatch(/^-?\d+$/);
        }
        if (e.name === "gd") expect(e.attrs.fmla).toMatch(/^val -?\d+$/);
      });
    }
  });

  it("only names preset geometries of ECMA-376 and knows every preset the catalogue has", () => {
    for (const name of Object.keys(files).filter((n) => /^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(n))) {
      walk(parseXml(text(files, name)), (e) => {
        if (e.name === "prstGeom") expect(PRESET_NAMES.has(e.attrs.prst!), `${name}: ${e.attrs.prst}`).toBe(true);
      });
    }
    expect(PRESET_GEOMETRIES.filter((g) => !PRESET_NAMES.has(PRESET_ALIASES[g] ?? g))).toEqual([]);
    expect(text(files, "ppt/slides/slide3.xml")).not.toContain("notAShape");
  });
});

describe("PPTX export: content", () => {
  const deck = fullDeck();
  const files = unzip(toPptx(deck, { date: DATE }));
  const slide = (n: number) => text(files, `ppt/slides/slide${n}.xml`);

  it("writes theme colours as the names the colour map gives them", () => {
    for (const name of Object.keys(files).filter((n) => /^ppt\/(slides|slideLayouts|slideMasters|notes)/.test(n))) {
      const xml = text(files, name);
      expect(xml, name).not.toMatch(/schemeClr val="(dk1|lt1|dk2|lt2)"/);
    }
    expect(slide(3)).toContain('<a:schemeClr val="tx1"/>');
    expect(slide(3)).toContain('<a:schemeClr val="bg1"><a:shade val="75000"/></a:schemeClr>');
    expect(text(files, "ppt/slideMasters/slideMaster1.xml")).toContain('<p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>');
    expect(text(files, "ppt/slideMasters/slideMaster1.xml")).toContain('<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"');
    expect(slide(2)).toContain('<a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>');
    // the clrScheme itself keeps the real slot names
    const theme = text(files, "ppt/theme/theme1.xml");
    expect(theme).toContain('<a:dk1><a:srgbClr val="000000"/></a:dk1>');
    expect(theme).toContain('<a:accent1><a:srgbClr val="4285F4"/></a:accent1>');
    expect(theme).toContain('<a:latin typeface="Arial"/>');
  });

  it("writes tint and shade as the share of the colour that stays, and alpha as a percentage", () => {
    expect(slide(2)).toContain('<a:schemeClr val="bg2"><a:tint val="50000"/><a:alpha val="50000"/></a:schemeClr>');
    expect(slide(2)).toContain('<a:srgbClr val="112233"/>');
    const alpha = unzip(toPptx(withShape({ fill: "#ff000080" }), { date: DATE }));
    expect(text(alpha, "ppt/slides/slide1.xml")).toContain('<a:srgbClr val="FF0000"><a:alpha val="50196"/></a:srgbClr>');
  });

  it("writes the second theme with its own colours and fonts", () => {
    const theme = text(files, "ppt/theme/theme2.xml");
    expect(theme).toContain('name="Dark &lt;1&gt;"');
    expect(theme).toContain('<a:dk1><a:srgbClr val="FFFFFF"/></a:dk1>');
    expect(theme).toContain('<a:majorFont><a:latin typeface="Georgia"/>');
    expect(theme).toContain('<a:minorFont><a:latin typeface="Verdana"/>');
    const fmt = parseXml(theme);
    const lists: Record<string, number> = {};
    walk(fmt, (e, path) => {
      if (path[path.length - 1] === "fmtScheme") lists[e.name] = e.children.filter((c) => typeof c !== "string").length;
    });
    expect(lists).toEqual({ fillStyleLst: 3, lnStyleLst: 3, effectStyleLst: 3, bgFillStyleLst: 3 });
  });

  it("maps layout kinds, placeholders and their inheritance", () => {
    const layout1 = text(files, "ppt/slideLayouts/slideLayout1.xml");
    expect(layout1).toContain('type="title"');
    expect(layout1).toContain('<p:ph type="ctrTitle"/>');
    expect(layout1).toContain('<p:ph type="subTitle" idx="1"/>');
    expect(text(files, "ppt/slideLayouts/slideLayout2.xml")).toContain('type="obj"');
    expect(text(files, "ppt/slideLayouts/slideLayout3.xml")).toContain('type="secHead"');
    expect(text(files, "ppt/slideLayouts/slideLayout3.xml")).toContain('showMasterSp="0"');
    expect(text(files, "ppt/slideLayouts/slideLayout3.xml")).toContain('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FAFAFA"/>');
    expect(text(files, "ppt/slideLayouts/slideLayout4.xml")).toContain('type="twoObj"');
    expect(text(files, "ppt/slideLayouts/slideLayout5.xml")).toContain('type="titleOnly"');
    expect(text(files, "ppt/slideLayouts/slideLayout6.xml")).toContain('type="objTx"');
    expect(text(files, "ppt/slideLayouts/slideLayout7.xml")).toContain('type="cust"');
    expect(text(files, "ppt/slideLayouts/slideLayout9.xml")).toContain('type="blank"');
    // layouts have their frames, the slide's empty placeholders don't
    expect(layout1).toContain("<a:xfrm><a:off");
    const s1 = slide(1);
    expect(s1).toContain('<p:ph type="ctrTitle"/>');
    expect(s1).toContain('<p:ph type="subTitle" idx="1"/>');
    expect(s1.match(/<a:off /g)!.length).toBe(1); // only the group header: the placeholders inherit their frames
    expect(s1).toContain("<p:spPr/>");
    // a slide's second column placeholder takes the layout's idx
    const master1 = text(files, "ppt/slideMasters/slideMaster1.xml");
    expect(master1).toContain('<p:ph type="body" idx="1"/>');
    expect(master1).toContain('<p:ph type="dt" idx="10"/>');
    // the first slide uses layout 1 and the third (titleOnly) layout 5
    expect(text(files, "ppt/slides/_rels/slide1.xml.rels")).toContain('Target="../slideLayouts/slideLayout1.xml"');
    expect(text(files, "ppt/slides/_rels/slide3.xml.rels")).toContain('Target="../slideLayouts/slideLayout5.xml"');
    expect(text(files, "ppt/slides/_rels/slide4.xml.rels")).toContain(`Target="../slideLayouts/slideLayout${deck.masters[0]!.layouts.length + 2}.xml"`);
    expect(text(files, "ppt/slideLayouts/_rels/slideLayout1.xml.rels")).toContain('Target="../slideMasters/slideMaster1.xml"');
  });

  it("writes master text styles with levels 1 to 9", () => {
    const master = parseXml(text(files, "ppt/slideMasters/slideMaster1.xml"));
    const levels: Record<string, string[]> = {};
    walk(master, (e) => {
      if (["titleStyle", "bodyStyle", "otherStyle"].includes(e.name)) levels[e.name] = e.children.filter((c): c is XmlElement => typeof c !== "string").map((c) => c.name);
    });
    expect(levels.titleStyle).toEqual(["lvl1pPr"]);
    expect(levels.bodyStyle).toEqual(["lvl1pPr", "lvl2pPr", "lvl3pPr", "lvl4pPr", "lvl5pPr", "lvl6pPr", "lvl7pPr", "lvl8pPr", "lvl9pPr"]);
    const xml = text(files, "ppt/slideMasters/slideMaster1.xml");
    expect(xml).toContain('<a:buChar char="●"/>');
    expect(xml).toContain('<a:latin typeface="+mj-lt"/>');
    expect(text(files, "ppt/presentation.xml")).toContain('<a:lvl9pPr marL="0" indent="0" algn="l">');
  });

  it("writes text: properties, runs, fields, line breaks, hyperlinks and empty paragraphs", () => {
    const s = slide(2);
    expect(s).toContain('<a:rPr b="1"><a:solidFill>');
    expect(s).toContain('<a:pPr marL="457200" indent="-228600"><a:lnSpc><a:spcPct val="150000"/></a:lnSpc><a:spcBef><a:spcPts val="600"/></a:spcBef><a:spcAft><a:spcPts val="300"/></a:spcAft><a:buClr><a:srgbClr val="FF0000"/></a:buClr><a:buSzPct val="80000"/><a:buFont typeface="Arial"/><a:buChar char="*"/></a:pPr>');
    expect(s).toContain('<a:pPr lvl="1"><a:buAutoNum type="alphaLcPeriod" startAt="3"/></a:pPr>');
    expect(s).toContain('<a:rPr baseline="-25000"/>');
    expect(s).toContain('<a:rPr sz="1250" i="1" strike="sngStrike" cap="all" spc="150" baseline="30000"><a:highlight><a:srgbClr val="FFFF00"/></a:highlight><a:latin typeface="+mj-lt"/></a:rPr>');
    expect(s).toMatch(/<a:fld id="\{[0-9A-F]{8}-0000-4000-8000-000000000000\}" type="slidenum"><a:rPr\/><a:t>7<\/a:t><\/a:fld>/);
    expect(s).toContain('<a:pPr algn="just" rtl="1"><a:buNone/></a:pPr>');
    expect(s).toContain("<a:br><a:rPr cap=\"small\"/></a:br>");
    expect(s).toContain('<a:rPr u="sng"><a:hlinkClick r:id="rId2"/></a:rPr>');
    expect(s).toContain("<a:endParaRPr/>");
    expect(text(files, "ppt/slides/_rels/slide2.xml.rels")).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/a%20b?x=1&amp;y=2" TargetMode="External"');
    expect(slide(1)).toContain("Hello, &quot;world&quot;");
    expect(slide(1)).toContain("<a:t>Hello, &quot;world&quot;</a:t>");
  });

  it("writes shapes: fill, gradient, line, shadow, geometry, text body, rotation and flips", () => {
    const s = slide(3);
    expect(s).toContain('descr="A decorative box"');
    expect(s).toContain('name="Box"');
    expect(s).toContain('<a:xfrm rot="1800000" flipH="1"><a:off x="254000" y="1524000"/><a:ext cx="2540000" cy="1270000"/></a:xfrm>');
    expect(s).toContain('<a:prstGeom prst="rect"><a:avLst><a:gd name="adj" fmla="val 12500"/></a:avLst></a:prstGeom>');
    expect(s).toContain('<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="tx1"/></a:gs><a:gs pos="100000"><a:schemeClr val="bg1"><a:shade val="75000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>');
    expect(s).toContain('<a:ln w="31750" cap="rnd"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill>');
    expect(s).toContain('<a:prstDash val="lgDashDot"/><a:bevel/><a:headEnd type="triangle"/><a:tailEnd type="arrow"/></a:ln>');
    expect(s).toContain('<a:effectLst><a:outerShdw blurRad="76200" dist="63500" dir="3187806" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"/></a:outerShdw></a:effectLst>');
    expect(s).toContain('<a:bodyPr wrap="none" lIns="50800" tIns="25400" rIns="76200" bIns="101600" anchor="ctr"><a:normAutofit/></a:bodyPr>');
    expect(s).toContain('<a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="2000"/></a:lvl1pPr><a:lvl3pPr marL="127000"/></a:lstStyle>');
    expect(s).toContain('<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="50000"><a:srgbClr val="00FF00"/></a:gs><a:gs pos="100000"><a:srgbClr val="00FF00"/></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>');
    expect(s).toContain('hidden="1"');
    expect(s).toContain('<a:noFill/><a:ln w="0"><a:noFill/></a:ln>');
    expect(s).toContain('<p:cNvSpPr txBox="1"/>');
    expect(s).toContain('<a:spAutoFit/>');
    // a shape with no fill or line set is written with explicit noFill so no program styles it
    expect(s).toMatch(/<a:prstGeom prst="rect"><a:avLst\/><\/a:prstGeom><a:noFill\/><a:ln><a:noFill\/><\/a:ln>/);
    // hyperlink on a shape
    expect(text(files, "ppt/slides/_rels/slide3.xml.rels")).toContain('Target="https://example.com/"');
    expect(text(files, "ppt/slides/_rels/slide3.xml.rels")).toContain('Target="mailto:a@example.org"');
  });

  it("writes lines as connectors", () => {
    const s = slide(3);
    expect(s.match(/<p:cxnSp>/g)!.length).toBe(2);
    expect(s).toContain('<a:prstGeom prst="line"><a:avLst/></a:prstGeom>');
    expect(s).toContain('<a:prstGeom prst="bentConnector3">');
    expect(s).toContain('<a:headEnd type="oval"/><a:tailEnd type="stealth"/>');
  });

  it("writes pictures once per content, with crop, mask and alt text, and keeps web pictures as links", () => {
    const s = slide(3);
    const media = Object.keys(files).filter((n) => n.startsWith("ppt/media/"));
    // PNG (once for two uses and once as the fill), GIF, SVG + its PNG stand-in; the web picture is a link and blob: is dropped
    expect(media.sort()).toEqual(["ppt/media/image1.png", "ppt/media/image2.gif", "ppt/media/image3.png", "ppt/media/image4.svg"].sort());
    expect(files["ppt/media/image1.png"]![1]).toBe(0x50);
    expect(strFromU8(files["ppt/media/image4.svg"]!)).toContain("<svg");
    expect(s.match(/<p:pic>/g)!.length).toBe(5); // the picture that can't be stored (blob:) is left out
    expect(s).toContain('descr="Dot &lt;1&gt;"');
    expect(s).toContain('<a:srcRect l="10000" t="20000" r="5000"/>');
    expect(s).toContain('<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="solid"/></a:ln>');
    expect(s).toContain("<a:picLocks noChangeAspect=\"1\"/>");
    expect(s).toContain('<a:tile tx="0" ty="0" sx="100000" sy="100000" flip="none" algn="tl"/>');
    expect(s).toContain('<a:alphaModFix amt="50000"/>');
    expect(s).toContain('uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"');
    expect(s).toContain('<asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main"');
    const rels = text(files, "ppt/slides/_rels/slide3.xml.rels");
    expect(rels).toContain('Target="https://example.com/pic.png" TargetMode="External"');
    expect(rels).toContain('Target="../media/image1.png"');
    expect(s).toContain("r:link=");
    // equal pictures share the part; the PNG is related once per slide
    expect(rels.match(/image1\.png/g)!.length).toBe(1);
  });

  it("writes groups with the child space equal to the group's box", () => {
    const s = slide(3);
    const m = /<p:grpSp>.*?<a:xfrm><a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/><a:chOff x="(\d+)" y="(\d+)"\/><a:chExt cx="(\d+)" cy="(\d+)"\/><\/a:xfrm>/.exec(s)!;
    expect(m).toBeTruthy();
    expect(m.slice(1, 5)).toEqual(m.slice(5, 9));
    expect(s).toContain("in group");
    expect(s.match(/<p:grpSp>/g)!.length).toBe(1);
  });

  it("writes tables with spans, merges, borders and header and band fills", () => {
    const s = slide(4);
    expect(s).toContain('<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">');
    expect(s).toContain('<a:tblPr firstRow="1" bandRow="1"/>');
    expect((s.match(/<a:gridCol /g) ?? []).length).toBe(3);
    expect(s.match(/<a:tr /g)!.length).toBe(4);
    expect(s.match(/<a:tc[ >]/g)!.length).toBe(12);
    expect(s).toContain('gridSpan="2" rowSpan="2"');
    expect(s).toContain('hMerge="1"');
    expect(s).toContain('vMerge="1"');
    expect(s).toContain('hMerge="1" vMerge="1"');
    expect(s).toContain('gridSpan="2"');
    // header: accent fill, bold light text
    expect(s).toContain('<a:rPr b="1"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:rPr><a:t>Header</a:t>');
    expect(s).toContain('<a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:tcPr>');
    expect(s).toContain('<a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:tcPr>');
    expect(s).toContain('anchor="b"');
    expect(s).toContain('<a:lnT w="0"><a:noFill/></a:lnT>');
    expect(s).toContain('<a:lnL w="38100"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:prstDash val="dash"/></a:lnL>');
    expect(s).toContain('<a:lnR w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/>');
    const frame = /<p:xfrm><a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/><\/p:xfrm>/.exec(s)!;
    expect(Number(frame[3])).toBe(3 * Math.round((600 / 3) * 12700));
    expect(Number(frame[4])).toBe(4 * 32 * 12700);
  });

  it("writes notes as notes slides, background, hidden slides and transitions", () => {
    expect(text(files, "ppt/slides/_rels/slide1.xml.rels")).toContain("notesSlides/notesSlide1.xml");
    expect(text(files, "ppt/slides/_rels/slide2.xml.rels")).not.toContain("notesSlide");
    const n1 = text(files, "ppt/notesSlides/notesSlide1.xml");
    expect(n1).toContain("<a:t>First line of notes</a:t>");
    expect(n1).toContain("<a:t>Second line</a:t>");
    expect(n1).toContain('<p:ph type="sldImg"/>');
    expect(n1).toContain('<p:ph type="body" idx="1"/>');
    expect(text(files, "ppt/notesSlides/notesSlide2.xml")).toContain("Notes with &lt;markup&gt; &amp; more");
    expect(text(files, "ppt/notesSlides/_rels/notesSlide1.xml.rels")).toContain('Target="../notesMasters/notesMaster1.xml"');
    expect(text(files, "ppt/notesSlides/_rels/notesSlide1.xml.rels")).toContain('Target="../slides/slide1.xml"');
    expect(text(files, "ppt/presentation.xml")).toContain("<p:notesMasterIdLst><p:notesMasterId r:id=");
    expect(text(files, "ppt/presentation.xml")).toContain('<p:notesSz cx="6858000" cy="9144000"/>');
    expect(text(files, "ppt/notesMasters/notesMaster1.xml")).toContain('<p:ph type="sldImg" idx="2"/>');
    expect(slide(3)).toMatch(/^<\?xml[^>]*\?>\n<p:sld [^>]*show="0"/);
    expect(slide(1)).not.toContain("show=");
    expect(slide(1)).toContain('<p:transition spd="fast" advTm="4000"><p:fade/></p:transition>');
    expect(slide(2)).toContain('<p:transition spd="med"><p:push dir="r"/></p:transition>');
    expect(slide(2)).toContain('<p:bg><p:bgPr><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0">');
    expect(slide(2)).toContain('<a:lin ang="2700000" scaled="0"/>');
    expect(slide(3)).not.toContain("<p:transition");
  });

  it("maps each transition type to a PresentationML transition", () => {
    const kinds: [Parameters<DeckSession["setTransition"]>[1], string][] = [
      [{ type: "dissolve" }, "<p:dissolve/>"],
      [{ type: "slide", direction: "right" }, '<p:cover dir="l"/>'],
      [{ type: "wipe", direction: "down" }, '<p:wipe dir="u"/>'],
      [{ type: "zoom" }, '<p:zoom dir="in"/>'],
      [{ type: "cube", direction: "up" }, '<p:push dir="d"/>'],
    ];
    for (const [t, xml] of kinds) {
      const s = new DeckSession(createDeck());
      s.setTransition([s.deck.slides[0]!.id], t);
      expect(text(unzip(toPptx(s.deck, { date: DATE })), "ppt/slides/slide1.xml")).toContain(xml);
    }
    // "none" with an automatic advance still needs the element (the session itself drops a plain "none")
    const s = new DeckSession(createDeck());
    s.deck.slides[0]!.transition = { type: "none", advanceAfter: 2500 };
    expect(text(unzip(toPptx(s.deck, { date: DATE })), "ppt/slides/slide1.xml")).toContain('<p:transition advTm="2500"/>');
    s.deck.slides[0]!.transition = { type: "none" };
    expect(text(unzip(toPptx(s.deck, { date: DATE })), "ppt/slides/slide1.xml")).not.toContain("<p:transition");
  });

  it("gives empty slide-number placeholders of a master the slide number field", () => {
    expect(text(files, "ppt/slideMasters/slideMaster1.xml")).toContain('type="slidenum"');
  });

  it("escapes markup in names and text and removes characters XML cannot hold", () => {
    const s = new DeckSession(createDeck({ title: "T\u0001itle" }));
    const id = s.deck.slides[0]!.id;
    s.addTextBox(id, {}, "a < b && c > d \u0003 'q' \"dq\"");
    s.updateElement(id, s.deck.slides[0]!.elements[2]!.id, { name: 'x"><evil/>' });
    const out = unzip(toPptx(s.deck, { date: DATE }));
    for (const name of xmlNames(out)) expect(() => parseXml(text(out, name))).not.toThrow();
    expect(text(out, "ppt/slides/slide1.xml")).toContain("a &lt; b &amp;&amp; c &gt; d  'q' &quot;dq&quot;");
    expect(text(out, "ppt/slides/slide1.xml")).not.toContain("<evil/>");
    expect(text(out, "docProps/core.xml")).toContain("<dc:title>Title</dc:title>");
  });
});

describe("PPTX export: samples for other readers", () => {
  // PLI_PPTX_OUT=/some/dir pnpm vitest run packages/decks/test/pptx-write.test.ts writes the sample files for opening in other programs.
  it.skipIf(!process.env.PLI_PPTX_OUT)("writes sample.pptx and sample.potx", () => {
    const dir = process.env.PLI_PPTX_OUT!;
    writeFileSync(join(dir, "sample.pptx"), toPptx(fullDeck(), { date: DATE }));
    writeFileSync(join(dir, "sample.potx"), toPotx(fullDeck(), { date: DATE }));
  });
});

describe("PPTX export: templates", () => {
  it("toPotx writes the template content type and no slides", () => {
    const files = unzip(toPotx(fullDeck(), { date: DATE }));
    const { overrides } = contentTypes(files);
    expect(overrides.get("/ppt/presentation.xml")).toBe("application/vnd.openxmlformats-officedocument.presentationml.template.main+xml");
    expect(slideParts(files)).toEqual([]);
    expect(text(files, "ppt/presentation.xml")).not.toContain("sldIdLst");
    expect(text(files, "ppt/presentation.xml")).toContain("sldMasterIdLst");
    expect(Object.keys(files).filter((n) => n.startsWith("ppt/slideLayouts/") && n.endsWith(".xml"))).not.toEqual([]);
    expect(text(files, "docProps/app.xml")).toContain("<Slides>0</Slides>");
    for (const name of xmlNames(files)) expect(() => parseXml(text(files, name)), name).not.toThrow();
    const problems: string[] = [];
    for (const name of xmlNames(files).filter((n) => !n.endsWith(".rels"))) problems.push(...checkOrder(parseXml(text(files, name)), name));
    expect(problems).toEqual([]);
  });

  it("repairs a deck with no master or layout and a slide with an unknown layout", () => {
    const deck = createDeck();
    deck.slides[0]!.layout = "missing";
    const empty: Deck = { ...deck, masters: [] };
    const files = unzip(toPptx(empty, { date: DATE }));
    expect(slideParts(files).length).toBe(1);
    const bare: Deck = { ...deck, masters: [{ ...deck.masters[0]!, layouts: [] }] };
    const files2 = unzip(toPptx(bare, { date: DATE }));
    expect(Object.keys(files2).filter((n) => /slideLayout\d+\.xml$/.test(n)).length).toBe(1);
    for (const name of xmlNames(files2)) expect(() => parseXml(text(files2, name))).not.toThrow();
  });
});

describe("OPC writer", () => {
  it("refuses duplicate part names (also by case), parts without content type and dangling relationships", () => {
    const pkg = new OpcPackage();
    pkg.add(new Part("a/b.xml", "application/x-test+xml", "<a/>"));
    expect(() => pkg.add(new Part("a/B.xml", "application/x-test+xml"))).toThrow(/Duplicate/);
    expect(() => pkg.add(new Part("/a/c.xml", "t"))).toThrow(/valid part name/);
    const bad = new OpcPackage();
    bad.add(new Part("x.dat", undefined, "1"));
    expect(() => bad.write({ date: DATE })).toThrow(/content type/);
    const dangling = new OpcPackage();
    dangling.relate("t", "missing.xml");
    expect(() => dangling.write({ date: DATE })).toThrow(/missing part/);
  });

  it("writes relative targets and reuses equal relationships", () => {
    expect(relativeTarget("ppt/slides/slide1.xml", "ppt/media/image1.png")).toBe("../media/image1.png");
    expect(relativeTarget("ppt/presentation.xml", "ppt/slides/slide1.xml")).toBe("slides/slide1.xml");
    expect(relativeTarget("", "ppt/presentation.xml")).toBe("ppt/presentation.xml");
    const part = new Part("p.xml", "t");
    expect(part.relate("x", "a")).toBe("rId1");
    expect(part.relate("x", "a")).toBe("rId1");
    expect(part.relate("x", "a", true)).toBe("rId2");
  });
});

// ---- helpers -----------------------------------------------------------------------------------------------------

function withShape(props: Record<string, unknown>): Deck {
  const s = new DeckSession(createDeck());
  s.addShape(s.deck.slides[0]!.id, "rect", {}, props);
  return s.deck;
}
