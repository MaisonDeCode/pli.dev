import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseXml, elements, child, type XmlElement } from "@pli.dev/core";
import { DeckSession, buildTimeline, createDeck, fromPptx, toPptx, validateDeck, type Animation, type AnimationInput, type Deck, type Element } from "../src";
import { animEffect, deckWith, presets, setVis, timing, type Fx } from "./fixtures/timing-xml";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==";
const date = new Date(0);

/** Animations without their ids and with the defaults left out, pointing at element positions instead of ids. */
function plain(list: readonly Animation[], slideElements: readonly Element[]) {
  return list.map((a) => {
    const { id: _id, target, ...rest } = a;
    const out: Record<string, unknown> = { ...rest, target: slideElements.findIndex((e) => e.id === target), trigger: a.trigger ?? "onClick" };
    if (!out.delay) delete out.delay;
    if (out.repeat === 1) delete out.repeat;
    if (out.easing === "linear") delete out.easing;
    if (out.text === "all") delete out.text;
    return out;
  });
}

const slideXmlOf = (bytes: Uint8Array, n = 1): string => strFromU8(unzipSync(bytes)[`ppt/slides/slide${n}.xml`]!);

// ---- Round trip: every kind, class, trigger, direction, easing, repeat and text build ---------------------------

const DIRS = ["left", "right", "up", "down"] as const;
const TRIGGERS = ["onClick", "withPrevious", "afterPrevious"] as const;
const EASINGS = ["linear", "easeIn", "easeOut", "easeInOut"] as const;

/** Every combination the editor offers, with the other fields cycled so each value shows up with every kind. */
function combos(): AnimationInput[] {
  const list: AnimationInput[] = [];
  let i = 0;
  const extras = (): Partial<AnimationInput> => {
    i++;
    return {
      trigger: TRIGGERS[i % 3],
      easing: EASINGS[i % 4],
      delay: [0, 250, 1000][i % 3],
      repeat: [1, 3, 2.5][i % 3],
      duration: [500, 1000, 250, 2000][i % 4],
    };
  };
  for (const cls of ["entrance", "exit"] as const) {
    list.push({ target: "$0", kind: "appear", class: cls, ...extras(), duration: 0 });
    list.push({ target: "$1", kind: "fade", class: cls, ...extras() });
    for (const d of DIRS) list.push({ target: "$2", kind: "fly", class: cls, direction: d, ...extras() });
    for (const d of DIRS) list.push({ target: "$3", kind: "wipe", class: cls, direction: d, ...extras() });
    list.push({ target: "$4", kind: "zoom", class: cls, ...extras() });
    list.push({ target: "$0", kind: "spin", class: cls, amount: 270, ...extras() });
    list.push({ target: "$1", kind: "spin", class: cls, amount: -90, ...extras() });
    // by paragraph: on the text box (three paragraphs) and on a one-paragraph shape
    list.push({ target: "$1", kind: "fade", class: cls, text: "paragraph", ...extras() });
    list.push({ target: "$5", kind: "fly", class: cls, direction: "left", text: "paragraph", ...extras() });
    list.push({ target: "$1", kind: "wipe", class: cls, direction: "up", text: "paragraph", ...extras() });
    list.push({ target: "$1", kind: "appear", class: cls, text: "paragraph", ...extras(), duration: 0 });
  }
  list.push({ target: "$0", kind: "spin", class: "emphasis", amount: 720, ...extras() });
  list.push({ target: "$1", kind: "spin", class: "emphasis", amount: -360, text: "paragraph", ...extras() });
  list.push({ target: "$2", kind: "pulse", class: "emphasis", amount: 1.2, ...extras() });
  list.push({ target: "$3", kind: "grow", class: "emphasis", amount: 1.5, ...extras() });
  list.push({ target: "$4", kind: "grow", class: "emphasis", amount: 0.5, ...extras() });
  list.push({ target: "$2", kind: "motion", class: "emphasis", path: [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 150, y: -20.5 }], ...extras() });
  list.push({ target: "$0", kind: "motion", class: "emphasis", path: [{ x: 0, y: 0 }, { x: -30.25, y: 0 }], ...extras() });
  return list;
}

function build(shift: number) {
  const s = new DeckSession(createDeck({ title: "Animated" }));
  const slide = s.deck.slides[0]!.id;
  const a = s.addShape(slide, "rect", { x: 100, y: 100, w: 100, h: 50 });
  const b = s.addTextBox(slide, { x: 300, y: 100, w: 300, h: 100 }, "one\ntwo\nthree");
  const c = s.addShape(slide, "ellipse", { x: 100, y: 300, w: 100, h: 60 });
  const d = s.addShape(slide, "roundRect", { x: 300, y: 300, w: 100, h: 60 });
  const e = s.addImage(slide, PNG, { w: 5, h: 5 }, { x: 500, y: 300 });
  const f = s.addShape(slide, "rect", { x: 20, y: 20, w: 50, h: 30 }, { text: { paragraphs: [{ runs: [{ text: "single" }] }] } });
  const ids = [a.id, b.id, c.id, d.id, e.id, f.id];
  const list = combos().map((input, i) => ({ ...input, trigger: TRIGGERS[(i + shift) % 3] }) as AnimationInput);
  for (const input of list) s.addAnimation(slide, { ...input, target: ids[Number(input.target.slice(1))]! });
  return s;
}

describe("PPTX animations: round trip", () => {
  for (const shift of [0, 1, 2]) {
    it(`every kind, class, direction, easing, repeat and text build comes back (first effect ${TRIGGERS[shift]})`, () => {
      const s = build(shift);
      const slide = s.deck.slides[0]!;
      const bytes = toPptx(s.deck, { date });
      const back = fromPptx(bytes);
      expect(back.warnings).toEqual([]);
      const got = back.deck.slides[0]!;
      expect(() => validateDeck(back.deck)).not.toThrow();
      const want = plain(slide.animations!, slide.elements);
      const have = plain(got.animations ?? [], got.elements);
      expect(have).toHaveLength(want.length);
      want.forEach((w, i) => expect(have[i], `animation ${i}: ${JSON.stringify(w)}`).toEqual(w));
      // the same click steps and timings
      const a = buildTimeline(slide).map((st) => ({ auto: st.auto, effects: st.effects.map((e) => [e.start, e.end, e.paragraph]) }));
      const b = buildTimeline(got).map((st) => ({ auto: st.auto, effects: st.effects.map((e) => [e.start, e.end, e.paragraph]) }));
      expect(b).toEqual(a);
    });
  }

  it("writes nothing for a slide without animations, or whose animations can't be written", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!.id;
    const a = s.addShape(slide, "rect", { x: 1, y: 1, w: 10, h: 10 });
    expect(slideXmlOf(toPptx(s.deck, { date }))).not.toContain("p:timing");
    // an emphasis "fade" has no PowerPoint preset
    s.addAnimation(slide, { target: a.id, kind: "fade", class: "emphasis" });
    expect(slideXmlOf(toPptx(s.deck, { date }))).not.toContain("p:timing");
    expect(fromPptx(toPptx(s.deck, { date })).deck.slides[0]!.animations).toBeUndefined();
  });

  it("is deterministic", () => {
    const s = build(0);
    expect(toPptx(s.deck, { date })).toEqual(toPptx(s.deck, { date }));
  });

  it("keeps the animations of an element that is an animated picture, group or chart", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!.id;
    const pic = s.addImage(slide, PNG, { w: 5, h: 5 }, { x: 10, y: 10 });
    const x = s.addShape(slide, "rect", { x: 100, y: 10, w: 20, h: 20 });
    const y = s.addShape(slide, "rect", { x: 130, y: 10, w: 20, h: 20 });
    const g = s.group(slide, [x.id, y.id])!;
    const chart = s.addChart(slide, "bar", { x: 200, y: 100, w: 300, h: 200 });
    for (const t of [pic.id, g, chart.id]) s.addAnimation(slide, { target: t, kind: "fade" });
    const back = fromPptx(toPptx(s.deck, { date }));
    expect(back.warnings).toEqual([]);
    const got = back.deck.slides[0]!;
    expect(got.animations!.map((a) => got.elements.find((e) => e.id === a.target)!.type)).toEqual(["image", "group", "chart"]);
    const xml = slideXmlOf(toPptx(s.deck, { date }));
    expect(xml).toContain("<p:bldGraphic");
  });
});

// ---- The shape of what is written ------------------------------------------------------------------------------------

const ORDER: Record<string, string[]> = {
  sld: ["cSld", "clrMapOvr", "transition", "AlternateContent", "timing", "extLst"],
  timing: ["tnLst", "bldLst", "extLst"],
  cTn: ["stCondLst", "endCondLst", "endSync", "iterate", "childTnLst", "subTnLst"],
  cBhvr: ["cTn", "tgtEl", "attrNameLst"],
  anim: ["cBhvr", "tavLst"],
  animEffect: ["cBhvr", "progress"],
  set: ["cBhvr", "to"],
  animScale: ["cBhvr", "by", "from", "to"],
  animRot: ["cBhvr"],
  animMotion: ["cBhvr", "by", "from", "to", "rCtr"],
  seq: ["cTn", "prevCondLst", "nextCondLst"],
  tav: ["val"],
};

function checkOrder(node: XmlElement, path: string): void {
  const order = ORDER[node.name];
  if (order) {
    let at = -1;
    for (const c of elements(node)) {
      const i = order.indexOf(c.name);
      expect(i, `${path}/${c.name} is not allowed in ${node.name}`).toBeGreaterThanOrEqual(0);
      expect(i, `${path}/${c.name} is out of order in ${node.name}`).toBeGreaterThanOrEqual(at);
      at = i;
    }
  }
  for (const c of elements(node)) checkOrder(c, `${path}/${c.name}`);
}

function allNodes(node: XmlElement, out: XmlElement[] = []): XmlElement[] {
  out.push(node);
  for (const c of elements(node)) allNodes(c, out);
  return out;
}

describe("PPTX animations: written XML", () => {
  const s = build(1);
  const bytes = toPptx(s.deck, { date });
  const xml = slideXmlOf(bytes);
  const root = parseXml(xml);

  it("is well formed and in schema order, after the transition", () => {
    checkOrder(root, "sld");
    const names = elements(root).map((e) => e.name);
    expect(names.slice(0, 2)).toEqual(["cSld", "clrMapOvr"]);
    expect(names[names.length - 1]).toBe("timing");
    const x = spawnSync("xmllint", ["--noout", "-"], { input: xml });
    if (!x.error) expect(x.status, String(x.stderr)).toBe(0);
  });

  it("puts the timing after a transition", () => {
    const withTransition = new DeckSession(createDeck());
    const slide = withTransition.deck.slides[0]!.id;
    const a = withTransition.addShape(slide, "rect", { x: 1, y: 1, w: 10, h: 10 });
    withTransition.setTransition([slide], { type: "fade", duration: 900 });
    withTransition.addAnimation(slide, { target: a.id, kind: "fade" });
    const r = parseXml(slideXmlOf(toPptx(withTransition.deck, { date })));
    checkOrder(r, "sld");
    expect(elements(r).map((e) => e.name)).toEqual(["cSld", "clrMapOvr", "AlternateContent", "timing"]);
  });

  it("numbers p:cTn 1, 2, 3… in document order, once each, and points at real shapes", () => {
    const timing = child(root, "timing")!;
    const ids = allNodes(timing)
      .filter((n) => n.name === "cTn")
      .map((n) => Number(n.attrs.id));
    expect(ids[0]).toBe(1);
    expect(ids).toEqual(ids.map((_, i) => i + 1));
    expect(new Set(ids).size).toBe(ids.length);
    const shapeIds = new Set(allNodes(child(root, "cSld")!).filter((n) => n.name === "cNvPr").map((n) => n.attrs.id));
    const targets = allNodes(timing).filter((n) => n.name === "spTgt");
    expect(targets.length).toBeGreaterThan(50);
    for (const t of targets) expect(shapeIds.has(t.attrs.spid!)).toBe(true);
    for (const b of allNodes(timing).filter((n) => n.name === "bldP")) expect(shapeIds.has(b.attrs.spid!)).toBe(true);
    // every tn refers to the main sequence
    for (const t of allNodes(timing).filter((n) => n.name === "tn")) expect(t.attrs.val).toBe("2");
  });

  it("has the main sequence PowerPoint expects", () => {
    const timing = child(root, "timing")!;
    const tm = child(child(child(timing, "tnLst"), "par"), "cTn")!;
    expect(tm.attrs).toMatchObject({ id: "1", dur: "indefinite", restart: "never", nodeType: "tmRoot" });
    const seq = child(child(tm, "childTnLst"), "seq")!;
    expect(seq.attrs).toMatchObject({ concurrent: "1", nextAc: "seek" });
    expect(child(seq, "cTn")!.attrs).toMatchObject({ id: "2", nodeType: "mainSeq", dur: "indefinite" });
    // an effect: preset ids and node types
    const fx = allNodes(timing).filter((n) => n.name === "cTn" && n.attrs.presetID !== undefined);
    expect(fx.length).toBe(buildTimeline(s.deck.slides[0]!).reduce((n, st) => n + st.effects.length, 0));
    for (const e of fx) expect(["clickEffect", "withEffect", "afterEffect"]).toContain(e.attrs.nodeType);
    // click steps wait for the click; a first step that is not on click also starts on begin
    const steps = elements(child(child(seq, "cTn"), "childTnLst"));
    expect(steps.length).toBe(buildTimeline(s.deck.slides[0]!).length);
    for (const step of steps) expect(child(child(child(step, "cTn"), "stCondLst"), "cond")!.attrs.delay).toBe("indefinite");
  });

  it("writes an auto-start first step with the begin condition", () => {
    const first = steps(build(1));
    expect(first.auto).toBe(true);
    expect(xml).toContain('<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>');
  });

  it("builds text by paragraph with one effect per paragraph and a build list entry", () => {
    const d = new DeckSession(createDeck());
    const slide = d.deck.slides[0]!.id;
    const t = d.addTextBox(slide, { x: 10, y: 10, w: 200, h: 100 }, "one\ntwo\nthree");
    const box = d.addTextBox(slide, { x: 10, y: 200, w: 50, h: 50 }, "whole");
    d.addAnimation(slide, { target: t.id, kind: "fade", text: "paragraph" });
    d.addAnimation(slide, { target: box.id, kind: "fade" });
    const r = parseXml(slideXmlOf(toPptx(d.deck, { date })));
    const timingEl = child(r, "timing")!;
    const ranges = allNodes(timingEl).filter((n) => n.name === "pRg");
    // every behaviour of an effect points at its paragraph: set, animEffect (two each)
    expect(ranges.map((p) => `${p.attrs.st}-${p.attrs.end}`)).toEqual(["0-0", "0-0", "1-1", "1-1", "2-2", "2-2"]);
    const clicks = allNodes(timingEl).filter((n) => n.name === "cTn" && n.attrs.nodeType === "clickEffect");
    expect(clicks.length).toBe(4);
    const bld = elements(child(timingEl, "bldLst")).map((b) => ({ ...b.attrs }));
    expect(bld).toEqual([
      { spid: expect.any(String), grpId: "0", build: "p" },
      { spid: expect.any(String), grpId: "0", animBg: "1" },
    ]);
  });

  it("writes the presets PowerPoint knows", () => {
    const d = new DeckSession(createDeck());
    const slide = d.deck.slides[0]!.id;
    const a = d.addShape(slide, "rect", { x: 10, y: 10, w: 50, h: 50 });
    const list: [AnimationInput, string][] = [
      [{ target: a.id, kind: "appear" }, "entr:1:0"],
      [{ target: a.id, kind: "fade" }, "entr:10:0"],
      [{ target: a.id, kind: "fly", direction: "up" }, "entr:2:1"],
      [{ target: a.id, kind: "fly", direction: "right" }, "entr:2:2"],
      [{ target: a.id, kind: "fly", direction: "down" }, "entr:2:4"],
      [{ target: a.id, kind: "fly", direction: "left" }, "entr:2:8"],
      [{ target: a.id, kind: "zoom" }, "entr:53:16"],
      [{ target: a.id, kind: "wipe", direction: "down" }, "entr:22:4"],
      [{ target: a.id, kind: "spin" }, "entr:31:0"],
      [{ target: a.id, kind: "fade", class: "exit" }, "exit:10:0"],
      [{ target: a.id, kind: "spin", class: "emphasis" }, "emph:8:0"],
      [{ target: a.id, kind: "pulse" }, "emph:26:0"],
      [{ target: a.id, kind: "grow" }, "emph:6:0"],
      [{ target: a.id, kind: "motion" }, "path:0:0"],
    ];
    for (const [input] of list) d.addAnimation(slide, input);
    const got = allNodes(child(parseXml(slideXmlOf(toPptx(d.deck, { date }))), "timing")!)
      .filter((n) => n.name === "cTn" && n.attrs.presetID !== undefined)
      .map((n) => `${n.attrs.presetClass}:${n.attrs.presetID}:${n.attrs.presetSubtype}`);
    expect(got).toEqual(list.map(([, p]) => p));
    const x = slideXmlOf(toPptx(d.deck, { date }));
    expect(x).toContain('filter="wipe(down)"');
    expect(x).toContain('<p:strVal val="1+#ppt_h/2"/>');
    expect(x).toContain('by="21600000"');
    expect(x).toContain('<p:by x="150000" y="150000"/>');
    expect(x).toContain('path="M 0 0 L 0.13888889 0 E"');
  });

  it("writes easing and repeat on the effect", () => {
    const d = new DeckSession(createDeck());
    const slide = d.deck.slides[0]!.id;
    const a = d.addShape(slide, "rect", { x: 10, y: 10, w: 50, h: 50 });
    d.addAnimation(slide, { target: a.id, kind: "spin", class: "emphasis", easing: "easeInOut", repeat: 3, delay: 400 });
    d.addAnimation(slide, { target: a.id, kind: "fade", easing: "easeIn", trigger: "afterPrevious" });
    d.addAnimation(slide, { target: a.id, kind: "fade", class: "exit", easing: "easeOut", trigger: "withPrevious" });
    const fx = allNodes(child(parseXml(slideXmlOf(toPptx(d.deck, { date }))), "timing")!).filter((n) => n.name === "cTn" && n.attrs.presetID !== undefined);
    expect(fx[0]!.attrs).toMatchObject({ accel: "50000", decel: "50000", repeatCount: "3000", nodeType: "clickEffect" });
    expect(fx[1]!.attrs).toMatchObject({ accel: "100000", nodeType: "afterEffect" });
    expect(fx[1]!.attrs.decel).toBeUndefined();
    expect(fx[2]!.attrs).toMatchObject({ decel: "100000", nodeType: "withEffect" });
    expect(child(child(fx[0]!, "stCondLst"), "cond")!.attrs.delay).toBe("400");
  });

  it("converts with LibreOffice when it is asked to", () => {
    // run by hand: PLI_SOFFICE=1 pnpm vitest run packages/decks/test/pptx-animation.test.ts
    if (!process.env.PLI_SOFFICE) return;
    const soffice = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
    const dir = process.env.PLI_SOFFICE_DIR ?? "/tmp";
    writeFileSync(`${dir}/anim.pptx`, bytes);
    const r = spawnSync(soffice, ["--headless", "--convert-to", "pdf", "--outdir", dir, `${dir}/anim.pptx`], { timeout: 120_000 });
    expect(r.status).toBe(0);
  });
});

function steps(s: DeckSession) {
  return buildTimeline(s.deck.slides[0]!)[0]!;
}

// ---- Reading what PowerPoint writes ----------------------------------------------------------------------------------

const read = (t: string) => fromPptx(deckWith(t));
const anims = (t: string) => {
  const r = read(t);
  const slide = r.deck.slides[0]!;
  const names = new Map(slide.elements.map((e) => [e.id, e.name]));
  return { animations: slide.animations ?? [], names, warnings: r.warnings, slide };
};
const first = (t: string) => anims(t).animations[0]!;

describe("PPTX animations: reading PowerPoint's presets", () => {
  it("reads fade, with its timing, without notes", () => {
    const r = anims(timing([presets.fade(4, 750, { delay: 200 })]));
    expect(r.warnings).toEqual([]);
    expect(r.animations).toHaveLength(1);
    expect(r.animations[0]).toMatchObject({ kind: "fade", class: "entrance", trigger: "onClick", duration: 750, delay: 200 });
    expect(r.names.get(r.animations[0]!.target)).toBe("Box A");
    expect(() => validateDeck(read(timing([presets.fade(4)])).deck)).not.toThrow();
  });

  it("reads appear and disappear", () => {
    const r = anims(timing([presets.appear(4), presets.disappear(6)]));
    expect(r.warnings).toEqual([]);
    expect(r.animations.map((a) => [a.kind, a.class, a.duration])).toEqual([["appear", "entrance", 0], ["appear", "exit", 0]]);
  });

  for (const dir of ["up", "right", "down", "left"] as const) {
    it(`reads fly in and out from the ${dir}`, () => {
      const r = anims(timing([presets.fly(4, dir), presets.flyOut(6, dir, 800)]));
      expect(r.warnings).toEqual([]);
      expect(r.animations.map((a) => [a.kind, a.class, a.direction, a.duration])).toEqual([["fly", "entrance", dir, 500], ["fly", "exit", dir, 800]]);
      // PowerPoint's default smooth end is an ease out
      expect(r.animations[0]!.easing).toBe("easeOut");
      expect(r.animations[1]!.easing).toBe("easeIn");
    });
    it(`reads wipe in and out from the ${dir}`, () => {
      const r = anims(timing([presets.wipe(4, dir), presets.wipeOut(6, dir)]));
      expect(r.warnings).toEqual([]);
      expect(r.animations.map((a) => [a.kind, a.class, a.direction])).toEqual([["wipe", "entrance", dir], ["wipe", "exit", dir]]);
    });
  }

  it("reads zoom in and out", () => {
    const r = anims(timing([presets.zoom(4), presets.zoomOut(6)]));
    expect(r.warnings).toEqual([]);
    expect(r.animations.map((a) => [a.kind, a.class])).toEqual([["zoom", "entrance"], ["zoom", "exit"]]);
  });

  it("reads Grow & Turn as a spin that comes in, and its direction", () => {
    const r = anims(timing([presets.growTurn(4)]));
    expect(r.warnings).toEqual([]);
    expect(r.animations[0]).toMatchObject({ kind: "spin", class: "entrance", amount: -90 });
  });

  it("reads spin, pulse and grow/shrink emphasis", () => {
    const r = anims(timing([presets.spin(4, 21600000, 2000, { attrs: 'accel="50000" decel="50000" repeatCount="2000"' }), presets.pulse(6, 105000, 250), presets.grow(4, 150000), presets.grow(6, 50000, 1000), presets.spin(4, -10800000)]));
    expect(r.warnings).toEqual([]);
    expect(r.animations.map((a) => [a.kind, a.class, a.amount, a.duration, a.repeat, a.easing])).toEqual([
      ["spin", "emphasis", 360, 2000, 2, "easeInOut"],
      ["pulse", "emphasis", 1.05, 500, undefined, undefined],
      ["grow", "emphasis", 1.5, 2000, undefined, undefined],
      ["grow", "emphasis", 0.5, 1000, undefined, undefined],
      ["spin", "emphasis", -180, 2000, undefined, "easeInOut"],
    ]);
  });

  it("reads repeat counts from the effect, and what 'until the end of the slide' means", () => {
    const r = anims(timing([presets.spin(4, 21600000, 1000, { attrs: 'repeatCount="3000"' }), presets.spin(6, 21600000, 1000, { attrs: 'repeatCount="indefinite"' })]));
    expect(r.animations[0]!.repeat).toBe(3);
    expect(r.animations[1]!.repeat).toBeUndefined();
    expect(r.warnings.join("\n")).toMatch(/repeats until the end of the slide/);
  });

  it("reads a motion path, in points", () => {
    const r = anims(timing([presets.motion(4, "M 0 0 L 0.25 0.1 L 0.5 0 E", 1500)]));
    expect(r.warnings).toEqual([]);
    expect(r.animations[0]).toMatchObject({ kind: "motion", class: "emphasis", duration: 1500, path: [{ x: 0, y: 0 }, { x: 180, y: 54 }, { x: 360, y: 0 }] });
  });

  it("reads a curved motion path as straight pieces, and says so", () => {
    const r = anims(timing([presets.motion(4, "M 0 0 C 0.1 0 0.2 0.1 0.3 0.1 E")]));
    expect(r.animations[0]!.path!.length).toBe(9);
    expect(r.animations[0]!.path![8]).toMatchObject({ x: 216, y: 54 });
    expect(r.warnings.join("\n")).toMatch(/curved motion path/);
  });

  it("reads click, with-previous and after-previous, and their delays", () => {
    const r = anims(timing([presets.fade(4), presets.fade(6, 500, { node: "withEffect", delay: 300 }), presets.fly(5, "left", 500, { node: "afterEffect" }), presets.fade(4, 500, { node: "clickEffect" })]));
    expect(r.animations.map((a) => [a.trigger, a.delay])).toEqual([["onClick", undefined], ["withPrevious", 300], ["afterPrevious", undefined], ["onClick", undefined]]);
    const steps = buildTimeline(r.slide);
    expect(steps.map((s) => s.effects.length)).toEqual([3, 1]);
  });

  it("starts the slide with an animation that is not on click", () => {
    const r = anims(timing([presets.fade(4, 500, { node: "withEffect" }), presets.fade(6, 500, { node: "afterEffect" }), presets.fade(5)]));
    expect(r.animations.map((a) => a.trigger)).toEqual(["withPrevious", "afterPrevious", "onClick"]);
    expect(buildTimeline(r.slide)[0]!.auto).toBe(true);
  });

  it("merges paragraph-by-paragraph effects into one animation", () => {
    const bld = '<p:bldP spid="5" grpId="0" build="p"/>';
    const r = anims(timing([0, 1, 2].map((i) => presets.fade(5, 500, { para: i })), { bld }));
    expect(r.warnings).toEqual([]);
    expect(r.animations).toHaveLength(1);
    expect(r.animations[0]).toMatchObject({ kind: "fade", text: "paragraph", trigger: "onClick" });
    expect(buildTimeline(r.slide).map((s) => s.effects.length)).toEqual([1, 1, 1]);
  });

  it("reads a build whose first paragraph is on click and the rest after it as one build, and says so", () => {
    const r = anims(timing([0, 1, 2].map((i) => presets.wipe(5, "left", 500, { para: i, node: i === 0 ? "clickEffect" : "afterEffect" })), { bld: '<p:bldP spid="5" grpId="0" build="p"/>' }));
    expect(r.animations.map((a) => [a.text, a.trigger])).toEqual([["paragraph", "onClick"]]);
    expect(r.warnings.join("\n")).toMatch(/start like the first/);
  });

  it("animates the whole shape when only some paragraphs have an effect, and says so", () => {
    const r = anims(timing([presets.fade(5, 500, { para: 1 })]));
    expect(r.animations).toHaveLength(1);
    expect(r.animations[0]!.text).toBeUndefined();
    expect(r.warnings.join("\n")).toMatch(/Slide 1: .*some paragraphs only/);
  });

  it("reads several animations of one shape (in, emphasis, out)", () => {
    const r = anims(timing([presets.fade(4), presets.pulse(4), presets.fadeOut(4)]));
    expect(r.animations.map((a) => `${a.class}:${a.kind}`)).toEqual(["entrance:fade", "emphasis:pulse", "exit:fade"]);
    expect(new Set(r.animations.map((a) => a.id)).size).toBe(3);
  });
});

describe("PPTX animations: what is approximated or left out", () => {
  it("replaces a bounce with the nearest of what Pli has, and says which preset", () => {
    const r = anims(timing([presets.bounce(4)]));
    expect(r.animations).toHaveLength(1);
    expect(r.animations[0]).toMatchObject({ kind: "fly", class: "entrance", direction: "up" });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/^Slide 1: .*"Bounce" \(entrance preset 26\).*"Box A"/);
  });

  it("replaces a wheel with a fade", () => {
    const r = anims(timing([presets.wheel(6)]));
    expect(r.animations[0]).toMatchObject({ kind: "fade", class: "entrance", duration: 2000 });
    expect(r.warnings[0]).toMatch(/Slide 1: .*"Wheel" \(entrance preset 21\).*Fade/);
  });

  it("falls back on a pulse for an emphasis it does not know, a spin when it rotates", () => {
    const colour: Fx = {
      spid: 4,
      preset: 20,
      cls: "emph",
      body: (b) => `<p:animClr clrSpc="rgb" dir="cw"><p:cBhvr><p:cTn id="${b.id()}" dur="500" fill="hold"/>${b.tgt}<p:attrNameLst><p:attrName>fillcolor</p:attrName></p:attrNameLst></p:cBhvr></p:animClr>`,
    };
    const r = anims(timing([colour, presets.spin(6, 21600000, 1000, { preset: 12 })]));
    expect(r.animations.map((a) => a.kind)).toEqual(["pulse", "spin"]);
    expect(r.warnings.join("\n")).toMatch(/"Color Pulse" \(emphasis preset 20\)/);
    expect(r.warnings.join("\n")).toMatch(/emphasis preset 12/);
  });

  it("uses a fly's start edge from its values when the subtype is a corner", () => {
    const r = anims(timing([presets.fly(4, "left", 500, { sub: 9 })]));
    expect(r.animations[0]).toMatchObject({ kind: "fly", direction: "left" });
    expect(r.warnings).toEqual([]);
    const corner = anims(timing([{ ...presets.wipe(4, "left"), sub: 9, body: (b: Parameters<Fx["body"]>[0]) => setVis(b, true) + animEffect(b, "in", "wipe(left)", 500) }]));
    expect(corner.animations[0]).toMatchObject({ kind: "wipe", direction: "left" });
  });

  it("drops an animation of a shape inside a group, and one that isn't on the slide", () => {
    const r = anims(timing([presets.fade(11), presets.fade(99), presets.fade(10), presets.fade(4)]));
    expect(r.animations).toHaveLength(2);
    expect(r.names.get(r.animations[0]!.target)).toBe("Pair");
    expect(r.warnings.join("\n")).toMatch(/Slide 1: .*"Inner" inside a group/);
    expect(r.warnings.join("\n")).toMatch(/Slide 1: .*not on the slide/);
  });

  it("ignores an interactive sequence and sound or media commands, with warnings", () => {
    const interactive = `<p:seq concurrent="1" nextAc="seek"><p:cTn id="900" restart="whenNotActive" fill="hold" evtFilter="cancelBubble" nodeType="interactiveSeq"><p:stCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="4"/></p:tgtEl></p:cond></p:stCondLst><p:endSync evt="end" delay="0"><p:rtn val="all"/></p:endSync><p:childTnLst><p:par><p:cTn id="901" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="902" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${"<p:set/>"}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:seq>`;
    const withSound: Fx = { ...presets.fade(6), body: (b) => `<p:audio><p:cMediaNode vol="80000"><p:cTn id="${b.id()}" display="0"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn><p:tgtEl><p:sndTgt r:embed="rId9"/></p:tgtEl></p:cMediaNode></p:audio>` + presets.fade(6).body(b) };
    const r = anims(timing([presets.fade(4), withSound], { extraSeq: interactive }));
    expect(r.animations).toHaveLength(2);
    expect(r.warnings.join("\n")).toMatch(/clicking a shape was not imported/);
    expect(r.warnings.join("\n")).toMatch(/sounds and media/);
  });

  it("keeps going when a slide's timing is nonsense", () => {
    for (const t of ["<p:timing/>", "<p:timing><p:tnLst/></p:timing>", "<p:timing><p:tnLst><p:par/></p:tnLst></p:timing>", "<p:timing><p:tnLst><p:par><p:cTn><p:childTnLst><p:seq/></p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst><p:bldP/></p:bldLst></p:timing>"]) {
      const r = anims(t);
      expect(r.animations).toEqual([]);
      expect(r.slide.elements.length).toBeGreaterThan(0);
    }
  });
});

// ---- Timing it has not seen ------------------------------------------------------------------------------------------

/** A tiny deterministic generator, so a failure can be repeated. */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

/** The same XML with a random subset of its elements removed (or with their attributes scrambled). */
function mutate(node: XmlElement, rnd: () => number, p: number): string | null {
  if (rnd() < p) return null;
  const attrs = Object.entries(node.attrs)
    .filter(() => rnd() > p)
    .map(([k, v]) => ` ${k}="${rnd() < p / 2 ? ["", "-5", "abc", "indefinite", "99999999999", "NaN", "0-#ppt_w/2", "1e9", "-1"][Math.floor(rnd() * 9)] : v}"`)
    .join("");
  const inner = node.children.map((c) => (typeof c === "string" ? c : mutate(c, rnd, p))).join("");
  return `<p:${node.name}${attrs}>${inner}</p:${node.name}>`;
}

describe("PPTX animations: timing it has not seen", () => {
  const full = timing(
    [
      presets.fade(4),
      presets.fly(5, "left", 500, { node: "withEffect" }),
      presets.zoom(6, 500, { node: "afterEffect" }),
      ...[0, 1, 2].map((i) => presets.wipe(5, "down", 500, { para: i })),
      presets.spin(4),
      presets.pulse(6),
      presets.grow(5),
      presets.motion(4, "M 0 0 L 0.1 0.1 E"),
      presets.bounce(6),
      presets.fadeOut(4),
      presets.flyOut(5, "up"),
    ],
    { bld: '<p:bldP spid="5" grpId="0" build="p"/><p:bldP spid="4" grpId="0" animBg="1"/>' },
  );
  const root = parseXml(`<p:root xmlns:p="x">${full}</p:root>`);
  const timingNode = child(root, "timing")!;

  it("never throws, and always gives animations that pass validateDeck", () => {
    let readSome = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = lcg(seed);
      const t = mutate(timingNode, rnd, [0.02, 0.05, 0.1, 0.2][seed % 4]!);
      if (t === null) continue;
      const deck = fromPptx(deckWith(t));
      expect(() => validateDeck(deck.deck), `seed ${seed}`).not.toThrow();
      expect(deck.deck.slides[0]!.elements.length).toBeGreaterThan(0);
      if (deck.deck.slides[0]!.animations?.length) readSome++;
      // and the animations that were read can be written again
      const again = fromPptx(toPptx(deck.deck, { date }));
      expect(() => validateDeck(again.deck), `seed ${seed} again`).not.toThrow();
    }
    expect(readSome).toBeGreaterThan(100);
  });

  it("the unmodified timing reads in full", () => {
    const r = anims(full);
    expect(r.animations.map((a) => `${a.class}:${a.kind}`)).toEqual([
      "entrance:fade",
      "entrance:fly",
      "entrance:zoom",
      "entrance:wipe",
      "emphasis:spin",
      "emphasis:pulse",
      "emphasis:grow",
      "emphasis:motion",
      "entrance:fly", // the bounce
      "exit:fade",
      "exit:fly",
    ]);
    expect(r.animations[3]!.text).toBe("paragraph");
  });
});
