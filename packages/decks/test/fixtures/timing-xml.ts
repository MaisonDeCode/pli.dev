import { simpleDeck, sp, txBody, para, xfrm } from "./build-pptx";

/**
 * Hand-made `p:timing` markup the way PowerPoint writes it (invented shapes, nothing taken from a real file): one builder
 * per preset, and a `timing` that lays effects out in click steps, groups and ids like PowerPoint does.
 */

export interface B {
  /** The next `p:cTn` id. */
  id: () => number;
  /** The `p:tgtEl` of the effect. */
  tgt: string;
}

const attrNames = (...names: string[]) => `<p:attrNameLst>${names.map((n) => `<p:attrName>${n}</p:attrName>`).join("")}</p:attrNameLst>`;

export const setVis = (b: B, visible: boolean, delay = 0): string =>
  `<p:set><p:cBhvr><p:cTn id="${b.id()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn>${b.tgt}${attrNames("style.visibility")}</p:cBhvr><p:to><p:strVal val="${visible ? "visible" : "hidden"}"/></p:to></p:set>`;

export const anim = (b: B, attr: string, vals: ({ s: string } | { f: number })[], dur: number, additive = false): string =>
  `<p:anim calcmode="lin" valueType="num"><p:cBhvr${additive ? ' additive="base"' : ""}><p:cTn id="${b.id()}" dur="${dur}" fill="hold"/>${b.tgt}${attrNames(attr)}</p:cBhvr><p:tavLst>${vals
    .map((v, i) => `<p:tav tm="${Math.round((i * 100000) / (vals.length - 1))}"><p:val>${"s" in v ? `<p:strVal val="${v.s}"/>` : `<p:fltVal val="${v.f}"/>`}</p:val></p:tav>`)
    .join("")}</p:tavLst></p:anim>`;

export const animEffect = (b: B, transition: "in" | "out", filter: string, dur: number): string => `<p:animEffect transition="${transition}" filter="${filter}"><p:cBhvr><p:cTn id="${b.id()}" dur="${dur}"/>${b.tgt}</p:cBhvr></p:animEffect>`;

export interface Fx {
  /** Shape id (`p:cNvPr id`). */
  spid: number;
  preset: number;
  cls: "entr" | "exit" | "emph" | "path";
  sub?: number;
  node?: "clickEffect" | "withEffect" | "afterEffect";
  /** The delay of the effect's own start condition. */
  delay?: number;
  /** Extra attributes for the effect's `p:cTn` (`accel="50000" repeatCount="3000"`). */
  attrs?: string;
  /** For text builds: the paragraph (0-based). */
  para?: number;
  body: (b: B) => string;
  /** Left out of the build list when false. */
  grp?: boolean;
}

/** Effects, laid out the way PowerPoint does: a click effect starts a step, an "after" effect a new group in it. */
export function timing(effects: Fx[], opts: { bld?: string; extraSeq?: string; mainDelay?: string; media?: string } = {}): string {
  let n = 2;
  const id = () => ++n;
  const steps: string[][][] = [];
  const auto: boolean[] = [];
  for (const fx of effects) {
    const node = fx.node ?? "clickEffect";
    if (node === "clickEffect" || steps.length === 0) {
      steps.push([[]]);
      auto.push(node !== "clickEffect");
    } else if (node === "afterEffect") steps[steps.length - 1]!.push([]);
    const groups = steps[steps.length - 1]!;
    groups[groups.length - 1]!.push(effectXml(fx, node, id));
  }
  const stepXml = steps
    .map((groups, i) => {
      const sid = id();
      const inner = groups.map((g) => `<p:par><p:cTn id="${id()}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${g.join("")}</p:childTnLst></p:cTn></p:par>`);
      return `<p:par><p:cTn id="${sid}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/>${auto[i] ? '<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>' : ""}</p:stCondLst><p:childTnLst>${inner.join("")}</p:childTnLst></p:cTn></p:par>`;
    })
    .join("");
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${stepXml}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>${opts.extraSeq ?? ""}</p:childTnLst></p:cTn></p:par></p:tnLst>${opts.bld ? `<p:bldLst>${opts.bld}</p:bldLst>` : ""}</p:timing>`;
}

function effectXml(fx: Fx, node: string, id: () => number): string {
  const eid = id();
  const spTgt = `<p:spTgt spid="${fx.spid}">${fx.para === undefined ? "" : `<p:txEl><p:pRg st="${fx.para}" end="${fx.para}"/></p:txEl>`}</p:spTgt>`;
  const body = fx.body({ id, tgt: `<p:tgtEl>${spTgt}</p:tgtEl>` });
  return `<p:par><p:cTn id="${eid}" presetID="${fx.preset}" presetClass="${fx.cls}" presetSubtype="${fx.sub ?? 0}"${fx.attrs ? ` ${fx.attrs}` : ""} fill="hold"${fx.grp === false ? "" : ' grpId="0"'} nodeType="${node}"><p:stCondLst><p:cond delay="${fx.delay ?? 0}"/></p:stCondLst><p:childTnLst>${body}</p:childTnLst></p:cTn></p:par>`;
}

// ---- Presets, as PowerPoint writes them -----------------------------------------------------------------------------

const D = { up: ["0-#ppt_h/2", "ppt_y", 1], down: ["1+#ppt_h/2", "ppt_y", 4], left: ["0-#ppt_w/2", "ppt_x", 8], right: ["1+#ppt_w/2", "ppt_x", 2] } as const;

export const presets = {
  appear: (spid: number, o: Partial<Fx> = {}): Fx => ({ spid, preset: 1, cls: "entr", body: (b) => setVis(b, true), ...o }),
  disappear: (spid: number, o: Partial<Fx> = {}): Fx => ({ spid, preset: 1, cls: "exit", body: (b) => setVis(b, false), ...o }),
  fade: (spid: number, dur = 500, o: Partial<Fx> = {}): Fx => ({ spid, preset: 10, cls: "entr", body: (b) => setVis(b, true) + animEffect(b, "in", "fade", dur), ...o }),
  fadeOut: (spid: number, dur = 500, o: Partial<Fx> = {}): Fx => ({ spid, preset: 10, cls: "exit", body: (b) => animEffect(b, "out", "fade", dur) + setVis(b, false, dur - 1), ...o }),
  fly: (spid: number, dir: keyof typeof D, dur = 500, o: Partial<Fx> = {}): Fx => ({
    spid,
    preset: 2,
    cls: "entr",
    sub: D[dir][2],
    attrs: 'decel="50000"',
    body: (b) => setVis(b, true) + flyAnims(b, dir, dur, false),
    ...o,
  }),
  flyOut: (spid: number, dir: keyof typeof D, dur = 500, o: Partial<Fx> = {}): Fx => ({ spid, preset: 2, cls: "exit", sub: D[dir][2], attrs: 'accel="50000"', body: (b) => flyAnims(b, dir, dur, true) + setVis(b, false, dur - 1), ...o }),
  zoom: (spid: number, dur = 500, o: Partial<Fx> = {}): Fx => ({
    spid,
    preset: 53,
    cls: "entr",
    sub: 16,
    body: (b) => setVis(b, true) + anim(b, "ppt_w", [{ f: 0 }, { s: "#ppt_w" }], dur) + anim(b, "ppt_h", [{ f: 0 }, { s: "#ppt_h" }], dur) + animEffect(b, "in", "fade", dur),
    ...o,
  }),
  zoomOut: (spid: number, dur = 500, o: Partial<Fx> = {}): Fx => ({
    spid,
    preset: 53,
    cls: "exit",
    sub: 16,
    body: (b) => anim(b, "ppt_w", [{ s: "#ppt_w" }, { f: 0 }], dur) + anim(b, "ppt_h", [{ s: "#ppt_h" }, { f: 0 }], dur) + animEffect(b, "out", "fade", dur) + setVis(b, false, dur - 1),
    ...o,
  }),
  wipe: (spid: number, dir: keyof typeof D, dur = 500, o: Partial<Fx> = {}): Fx => ({ spid, preset: 22, cls: "entr", sub: D[dir][2], body: (b) => setVis(b, true) + animEffect(b, "in", `wipe(${dir})`, dur), ...o }),
  wipeOut: (spid: number, dir: keyof typeof D, dur = 500, o: Partial<Fx> = {}): Fx => ({ spid, preset: 22, cls: "exit", sub: D[dir][2], body: (b) => animEffect(b, "out", `wipe(${dir})`, dur) + setVis(b, false, dur - 1), ...o }),
  /** "Grow & Turn": it grows while it turns from 90 degrees. */
  growTurn: (spid: number, dur = 500, o: Partial<Fx> = {}): Fx => ({
    spid,
    preset: 31,
    cls: "entr",
    body: (b) => setVis(b, true) + anim(b, "ppt_w", [{ f: 0 }, { s: "#ppt_w" }], dur) + anim(b, "ppt_h", [{ f: 0 }, { s: "#ppt_h" }], dur) + anim(b, "style.rotation", [{ f: 90 }, { f: 0 }], dur) + animEffect(b, "in", "fade", dur),
    ...o,
  }),
  spin: (spid: number, by = 21600000, dur = 2000, o: Partial<Fx> = {}): Fx => ({
    spid,
    preset: 8,
    cls: "emph",
    attrs: 'accel="50000" decel="50000"',
    body: (b) => `<p:animRot by="${by}"><p:cBhvr><p:cTn id="${b.id()}" dur="${dur}" fill="hold"/>${b.tgt}${attrNames("r")}</p:cBhvr></p:animRot>`,
    ...o,
  }),
  /** Grow/Shrink to `pct` (in 1000ths of a percent: 150000 is 150%). */
  grow: (spid: number, pct = 150000, dur = 2000, o: Partial<Fx> = {}): Fx => ({
    spid,
    preset: 6,
    cls: "emph",
    body: (b) => `<p:animScale><p:cBhvr><p:cTn id="${b.id()}" dur="${dur}" fill="hold"/>${b.tgt}</p:cBhvr><p:by x="${pct}" y="${pct}"/></p:animScale>`,
    ...o,
  }),
  /** `dur` is half the pulse: it runs forward, then back. */
  pulse: (spid: number, pct = 105000, dur = 250, o: Partial<Fx> = {}): Fx => ({
    spid,
    preset: 26,
    cls: "emph",
    body: (b) => `<p:animScale><p:cBhvr><p:cTn id="${b.id()}" dur="${dur}" autoRev="1" fill="hold"/>${b.tgt}</p:cBhvr><p:by x="${pct}" y="${pct}"/></p:animScale>`,
    ...o,
  }),
  motion: (spid: number, path: string, dur = 2000, o: Partial<Fx> = {}): Fx => ({
    spid,
    preset: 0,
    cls: "path",
    grp: false,
    body: (b) => `<p:animMotion origin="layout" path="${path}" pathEditMode="relative" rAng="0" ptsTypes="AA"><p:cBhvr><p:cTn id="${b.id()}" dur="${dur}" fill="hold"/>${b.tgt}${attrNames("ppt_x", "ppt_y")}</p:cBhvr><p:rCtr x="0.1" y="0"/></p:animMotion>`,
    ...o,
  }),
  /** "Bounce" (entrance 26): Pli has no bounce. */
  bounce: (spid: number, dur = 1500, o: Partial<Fx> = {}): Fx => ({
    spid,
    preset: 26,
    cls: "entr",
    body: (b) => setVis(b, true) + anim(b, "ppt_x", [{ s: "#ppt_x" }, { s: "#ppt_x" }], dur, true) + anim(b, "ppt_y", [{ s: "0-#ppt_h/2" }, { s: "#ppt_y" }, { s: "#ppt_y-.1" }, { s: "#ppt_y" }], dur, true),
    ...o,
  }),
  /** "Wheel" (entrance 21): a filter Pli doesn't have. */
  wheel: (spid: number, dur = 2000, o: Partial<Fx> = {}): Fx => ({ spid, preset: 21, cls: "entr", sub: 1, body: (b) => setVis(b, true) + animEffect(b, "in", "wheel(1)", dur), ...o }),
};

function flyAnims(b: B, dir: keyof typeof D, dur: number, out: boolean): string {
  const [away, attr] = D[dir];
  const pair = (a: string, v: string, w: string) => (out ? anim(b, a, [{ s: w }, { s: v }], dur, true) : anim(b, a, [{ s: v }, { s: w }], dur, true));
  const first = attr === "ppt_x" ? pair("ppt_x", away, "#ppt_x") + pair("ppt_y", "#ppt_y", "#ppt_y") : pair("ppt_x", "#ppt_x", "#ppt_x") + pair("ppt_y", away, "#ppt_y");
  return first;
}

// ---- A deck around them ---------------------------------------------------------------------------------------------

/** Frame positions of the shapes of `deckWith`, in EMU on the 10 by 7.5 inch slide. */
export const SHAPES = {
  /** id 4 */ box: [457200, 1600200, 1828800, 914400],
  /** id 5: three paragraphs */ list: [3200400, 1600200, 3657600, 1828800],
  /** id 6 */ other: [457200, 3200400, 1828800, 914400],
} as const;

/** A 4:3 deck of one slide with three shapes (ids 4, 5 and 6; 5 has three paragraphs), a group (id 10 with 11 inside) and the given timing. */
export function deckWith(timingXml: string, extraShapes = ""): Uint8Array {
  const shapes =
    sp(4, "Box A", { spPr: `${xfrm(...SHAPES.box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`, tx: txBody(para("Alpha")) }) +
    sp(5, "List", { spPr: `${xfrm(...SHAPES.list)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`, tx: txBody(para("One") + para("Two") + para("Three")) }) +
    sp(6, "Box B", { spPr: `${xfrm(...SHAPES.other)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`, tx: txBody(para("Beta")) }) +
    `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Pair"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="4800600"/><a:ext cx="1828800" cy="914400"/><a:chOff x="0" y="4800600"/><a:chExt cx="1828800" cy="914400"/></a:xfrm></p:grpSpPr>${sp(11, "Inner", { spPr: `${xfrm(0, 4800600, 914400, 914400)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`, tx: txBody(para("In")) })}</p:grpSp>` +
    extraShapes;
  return simpleDeck([shapes], { slideTail: timingXml });
}
